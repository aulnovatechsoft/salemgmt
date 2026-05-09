import { z } from "zod";
import { eq, and, desc, gte, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "../create-context";
import {
  db,
  issues,
  issueComments,
  auditLogs,
  events,
  employees,
  notifications,
  notificationPreferences,
} from "@/backend/db";
import { dispatchPushForNotification } from "@/backend/services/notification.service";
import { allocateIssueDisplayId } from "@/backend/db/issueIdAllocator";

// 5-minute dedupe window — matches the in-tx pattern used elsewhere
// (see submitTaskForReview). Same value as DEDUPE_WINDOW_MS in the
// notification service.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
type Priority = (typeof PRIORITY_VALUES)[number];

/**
 * Authorization helper: who is allowed to act on a given issue.
 * Returns the loaded issue + event rows for downstream use, or throws.
 *
 * Allowed actors:
 *   · Original raiser
 *   · Currently escalated-to manager
 *   · The task's creator (createdBy)
 *   · The task's assigned manager (assignedTo)
 *   · Any ADMIN or CMD
 *
 * This intentionally mirrors `events.ts` `isPriv / isOwner / isManager`
 * shape so behaviour is consistent across the app. Frontend gating
 * (canResolve etc.) is purely cosmetic — this server check is the
 * actual security boundary.
 */
async function loadAndAuthorize(
  issueId: string,
  actorId: string,
): Promise<{ issue: typeof issues.$inferSelect; event: typeof events.$inferSelect | null; actor: typeof employees.$inferSelect }> {
  const [actor] = await db.select().from(employees).where(eq(employees.id, actorId)).limit(1);
  if (!actor) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session is no longer valid. Please log in again.' });
  }

  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!issue) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Issue not found.' });
  }

  const [event] = await db.select().from(events).where(eq(events.id, issue.eventId)).limit(1);

  const isPriv = actor.role === 'ADMIN' || actor.role === 'CMD';
  const isRaiser = issue.raisedBy === actorId;
  const isEscalatedTo = issue.escalatedTo === actorId;
  const isCreator = event?.createdBy === actorId;
  const isManager = event?.assignedTo === actorId;

  if (!isPriv && !isRaiser && !isEscalatedTo && !isCreator && !isManager) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not authorised to act on this issue.',
    });
  }

  return { issue, event: event ?? null, actor };
}

// ────────────────────────────────────────────────────────────────────────
// Read-side enrichment
// ────────────────────────────────────────────────────────────────────────
// The frontend used to fetch ALL employees and ALL events on the side
// just to render "Raised by: <name>" + "<task name> — <location>" on
// every issue card. That was both slow and fragile (it would render
// "Raised by: Unknown" the moment the raiser wasn't in the viewer's
// own employee scope). We instead join the related rows server-side and
// embed thin `event` / `raisedByEmployee` / `escalatedToEmployee` /
// `resolvedByEmployee` objects on each issue. The shape is stable so
// the client can render a card with zero extra lookups.
type EmployeeRef = { id: string; name: string; role: string; persNo: string | null } | null;
type EventRef = { id: string; displayId: string | null; name: string; location: string | null; category: string | null; createdBy: string | null; assignedTo: string | null } | null;

type EnrichedIssue = typeof issues.$inferSelect & {
  event: EventRef;
  raisedByEmployee: EmployeeRef;
  escalatedToEmployee: EmployeeRef;
  resolvedByEmployee: EmployeeRef;
};

async function enrichIssues(rows: (typeof issues.$inferSelect)[]): Promise<EnrichedIssue[]> {
  if (rows.length === 0) return [];

  const eventIds = Array.from(new Set(rows.map(r => r.eventId).filter(Boolean) as string[]));
  const employeeIds = Array.from(new Set(
    rows.flatMap(r => [r.raisedBy, r.escalatedTo, r.resolvedBy].filter(Boolean) as string[]),
  ));

  const [eventRows, employeeRows] = await Promise.all([
    eventIds.length > 0
      ? db.select({
          id: events.id,
          displayId: events.displayId,
          name: events.name,
          location: events.location,
          category: events.category,
          createdBy: events.createdBy,
          assignedTo: events.assignedTo,
        }).from(events).where(inArray(events.id, eventIds))
      : Promise.resolve([] as EventRef[]),
    employeeIds.length > 0
      ? db.select({
          id: employees.id,
          name: employees.name,
          role: employees.role,
          persNo: employees.persNo,
        }).from(employees).where(inArray(employees.id, employeeIds))
      : Promise.resolve([] as EmployeeRef[]),
  ]);

  const eventById = new Map<string, EventRef>();
  for (const e of eventRows as Exclude<EventRef, null>[]) eventById.set(e.id, e);
  const employeeById = new Map<string, EmployeeRef>();
  for (const e of employeeRows as Exclude<EmployeeRef, null>[]) employeeById.set(e.id, e);

  return rows.map(r => ({
    ...r,
    event: eventById.get(r.eventId) ?? null,
    raisedByEmployee: r.raisedBy ? (employeeById.get(r.raisedBy) ?? null) : null,
    escalatedToEmployee: r.escalatedTo ? (employeeById.get(r.escalatedTo) ?? null) : null,
    resolvedByEmployee: r.resolvedBy ? (employeeById.get(r.resolvedBy) ?? null) : null,
  }));
}

export const issuesRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  getAll: authedProcedure
    .input(z.object({
      eventId: z.string().uuid().optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all issues", input);
      const conds = [] as any[];
      if (input?.eventId) conds.push(eq(issues.eventId, input.eventId));
      if (input?.status) conds.push(eq(issues.status, input.status));
      const q = db.select().from(issues);
      const rows = conds.length > 0
        ? await q.where(and(...conds)).orderBy(desc(issues.createdAt))
        : await q.orderBy(desc(issues.createdAt));
      return enrichIssues(rows);
    }),

  getById: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await db.select().from(issues).where(eq(issues.id, input.id));
      if (!result[0]) return null;
      const [enriched] = await enrichIssues(result);
      return enriched;
    }),

  getByEvent: authedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await db.select().from(issues)
        .where(eq(issues.eventId, input.eventId))
        .orderBy(desc(issues.createdAt));
      return enrichIssues(rows);
    }),

  getByRaisedBy: authedProcedure
    .input(z.object({ raisedBy: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (input.raisedBy !== ctx.employeeId) {
        const [actor] = await db.select({ role: employees.role })
          .from(employees).where(eq(employees.id, ctx.employeeId)).limit(1);
        if (!actor || (actor.role !== 'ADMIN' && actor.role !== 'CMD')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own raised issues.' });
        }
      }
      const rows = await db.select().from(issues)
        .where(eq(issues.raisedBy, input.raisedBy))
        .orderBy(desc(issues.createdAt));
      return enrichIssues(rows);
    }),

  getByStatus: authedProcedure
    .input(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }))
    .query(async ({ input }) => {
      const rows = await db.select().from(issues)
        .where(eq(issues.status, input.status))
        .orderBy(desc(issues.createdAt));
      return enrichIssues(rows);
    }),

  getOpenCount: authedProcedure
    .query(async () => {
      const result = await db.select().from(issues)
        .where(eq(issues.status, 'OPEN'));
      return result.length;
    }),

  // ─── Comments ─────────────────────────────────────────────────────────────

  listComments: authedProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      // Authz: same predicate as loadAndAuthorize. Anyone who can see /
      // act on the issue can read its discussion thread.
      await loadAndAuthorize(input.issueId, ctx.employeeId);
      const rows = await db.select({
        id: issueComments.id,
        issueId: issueComments.issueId,
        authorId: issueComments.authorId,
        body: issueComments.body,
        createdAt: issueComments.createdAt,
        authorName: employees.name,
        authorRole: employees.role,
      })
        .from(issueComments)
        .leftJoin(employees, eq(employees.id, issueComments.authorId))
        .where(eq(issueComments.issueId, input.issueId))
        .orderBy(asc(issueComments.createdAt));
      return rows;
    }),

  addComment: authedProcedure
    .input(z.object({
      issueId: z.string().uuid(),
      body: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const actorId = ctx.employeeId;
      const { issue, event } = await loadAndAuthorize(input.issueId, actorId);

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        const pushList: PushParams[] = [];
        const [comment] = await tx.insert(issueComments).values({
          issueId: input.issueId,
          authorId: actorId,
          body: input.body.trim(),
        }).returning();

        await tx.insert(auditLogs).values({
          action: 'COMMENT_ISSUE',
          entityType: 'ISSUE',
          entityId: input.issueId,
          performedBy: actorId,
          details: { commentId: comment.id },
        });

        // Notify all participants except the actor: raiser + escalatedTo
        // (the two "owners" of the issue). Skip when the recipient has
        // turned ISSUE_COMMENT off in their preferences.
        const recipients = new Set<string>();
        if (issue.raisedBy && issue.raisedBy !== actorId) recipients.add(issue.raisedBy);
        if (issue.escalatedTo && issue.escalatedTo !== actorId) recipients.add(issue.escalatedTo);

        if (recipients.size > 0) {
          const [actorRow] = await tx.select({ name: employees.name })
            .from(employees).where(eq(employees.id, actorId)).limit(1);
          const preview = input.body.trim().slice(0, 80);
          const title = 'New comment on issue';
          const message = `${actorRow?.name ?? 'Someone'} commented on "${event?.name ?? 'an issue'}": ${preview}`;

          for (const recipientId of recipients) {
            const [pref] = await tx.select({ enabled: notificationPreferences.enabled })
              .from(notificationPreferences).where(and(
                eq(notificationPreferences.employeeId, recipientId),
                eq(notificationPreferences.notificationType, 'ISSUE_COMMENT'),
              )).limit(1);
            if (pref?.enabled === false) continue;

            // Per-comment dedupe key (include comment id) so multiple
            // comments by the same actor don't collide in the 5-min
            // window — each comment is a real distinct event.
            const dedupeKey = `ISSUE:${input.issueId}:ISSUE_COMMENT:${comment.id}`;
            const [inserted] = await tx.insert(notifications).values({
              recipientId,
              type: 'ISSUE_COMMENT',
              title,
              message,
              entityType: 'ISSUE',
              entityId: input.issueId,
              metadata: {
                commentId: comment.id,
                eventName: event?.name ?? null,
                authorName: actorRow?.name ?? null,
              },
              dedupeKey,
            }).returning({ id: notifications.id });
            if (inserted?.id) {
              pushList.push({ notificationId: inserted.id, recipientId, title, message });
            }
          }
        }

        return { comment, pushList };
      });

      // Push dispatch outside tx — best-effort, must never roll back.
      for (const p of result.pushList) {
        await dispatchPushForNotification({
          notificationId: p.notificationId,
          recipientId: p.recipientId,
          type: 'ISSUE_COMMENT',
          title: p.title,
          message: p.message,
          entityType: 'ISSUE',
          entityId: input.issueId,
        });
      }

      return result.comment;
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  create: authedProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      raisedBy: z.string().uuid().optional(),
      type: z.enum(['MATERIAL_SHORTAGE', 'SITE_ACCESS', 'EQUIPMENT', 'NETWORK_PROBLEM', 'OTHER']),
      description: z.string().min(1),
      escalatedTo: z.string().uuid().optional().nullable(),
      priority: z.enum(PRIORITY_VALUES).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.raisedBy && input.raisedBy !== ctx.employeeId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only raise issues as yourself.',
        });
      }
      const actorId = ctx.employeeId;
      const priority: Priority = input.priority ?? 'medium';

      const [eventRow] = await db.select().from(events)
        .where(eq(events.id, input.eventId)).limit(1);
      if (!eventRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found.' });
      }

      let escalateTargetId: string | null = input.escalatedTo ?? null;
      if (escalateTargetId === actorId) {
        escalateTargetId = null;
      }
      if (escalateTargetId) {
        const [target] = await db.select({ id: employees.id })
          .from(employees).where(eq(employees.id, escalateTargetId)).limit(1);
        if (!target) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escalation target is not a valid employee.' });
        }
      } else if (eventRow.createdBy && eventRow.createdBy !== actorId) {
        escalateTargetId = eventRow.createdBy;
      }

      // Walk one step up the reporting chain when the raiser IS the
      // task creator (manager-on-own-task) so the issue still has an
      // upstream owner. See replit.md gotcha for full rationale.
      if (!escalateTargetId) {
        const [raiserRow] = await db.select({
          reportingPersNo: employees.reportingPersNo,
        }).from(employees).where(eq(employees.id, actorId)).limit(1);
        const reportingPersNo = raiserRow?.reportingPersNo?.trim();
        if (reportingPersNo) {
          const [manager] = await db.select({ id: employees.id })
            .from(employees).where(eq(employees.persNo, reportingPersNo)).limit(1);
          if (manager && manager.id !== actorId) {
            escalateTargetId = manager.id;
          }
        }
      }

      const displayId = await allocateIssueDisplayId();

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        const timeline = [{
          action: 'Issue Created',
          performedBy: actorId,
          timestamp: new Date().toISOString(),
        }];
        if (escalateTargetId) {
          // Mirror the create-side fact in the timeline so the raiser
          // can SEE that the issue has an owner (no longer a guess
          // from the card header).
          timeline.push({
            action: 'Escalated on creation',
            performedBy: actorId,
            timestamp: new Date().toISOString(),
          });
        }

        const [created] = await tx.insert(issues).values({
          displayId,
          eventId: input.eventId,
          raisedBy: actorId,
          type: input.type,
          description: input.description,
          priority,
          escalatedTo: escalateTargetId,
          timeline,
        }).returning();

        await tx.insert(auditLogs).values({
          action: 'CREATE_ISSUE',
          entityType: 'ISSUE',
          entityId: created.id,
          performedBy: actorId,
          details: {
            eventId: input.eventId,
            type: input.type,
            priority,
            escalatedTo: escalateTargetId,
          },
        });

        let createdNotificationId: string | null = null;
        if (escalateTargetId && escalateTargetId !== actorId) {
          const [pref] = await tx.select({
            enabled: notificationPreferences.enabled,
          }).from(notificationPreferences).where(and(
            eq(notificationPreferences.employeeId, escalateTargetId),
            eq(notificationPreferences.notificationType, 'ISSUE_RAISED'),
          )).limit(1);
          const enabled = pref?.enabled ?? true;
          if (enabled) {
            const [actorRow] = await tx.select({ name: employees.name })
              .from(employees).where(eq(employees.id, actorId)).limit(1);
            const dedupeKey = `ISSUE:${created.id}:ISSUE_RAISED:${actorId}`;
            const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);
            const [dup] = await tx.select({ id: notifications.id })
              .from(notifications).where(and(
                eq(notifications.recipientId, escalateTargetId),
                eq(notifications.type, 'ISSUE_RAISED'),
                eq(notifications.dedupeKey, dedupeKey),
                gte(notifications.createdAt, windowStart),
              )).limit(1);
            if (!dup) {
              const title = 'New Issue Raised';
              const message = `${actorRow?.name ?? 'A team member'} raised a ${input.type} issue for "${eventRow.name}"`;
              const [inserted] = await tx.insert(notifications).values({
                recipientId: escalateTargetId,
                type: 'ISSUE_RAISED',
                title,
                message,
                entityType: 'ISSUE',
                entityId: created.id,
                metadata: {
                  issueType: input.type,
                  priority,
                  eventName: eventRow.name,
                  raisedByName: actorRow?.name ?? null,
                },
                dedupeKey,
              }).returning({ id: notifications.id });
              createdNotificationId = inserted?.id ?? null;
              if (createdNotificationId) {
                pushParams = {
                  notificationId: createdNotificationId,
                  recipientId: escalateTargetId,
                  title,
                  message,
                };
              }
            }
          }
        }

        return { created, createdNotificationId, escalateTargetId, pushParams };
      });

      if (result.pushParams) {
        await dispatchPushForNotification({
          notificationId: result.pushParams.notificationId,
          recipientId: result.pushParams.recipientId,
          type: 'ISSUE_RAISED',
          title: result.pushParams.title,
          message: result.pushParams.message,
          entityType: 'ISSUE',
          entityId: result.created.id,
        });
      }

      return result.created;
    }),

  updateStatus: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
      updatedBy: z.string().uuid().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.updatedBy && input.updatedBy !== ctx.employeeId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only update issues as yourself.',
        });
      }
      const actorId = ctx.employeeId;

      await loadAndAuthorize(input.id, actorId);

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        const [existing] = await tx.select().from(issues)
          .where(eq(issues.id, input.id)).for('update').limit(1);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Issue not found.' });
        }
        const [event] = await tx.select().from(events)
          .where(eq(events.id, existing.eventId)).limit(1);
        const [actor] = await tx.select({ role: employees.role })
          .from(employees).where(eq(employees.id, actorId)).limit(1);
        if (!actor) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session is no longer valid.' });
        }
        const isPriv = actor.role === 'ADMIN' || actor.role === 'CMD';
        const isRaiser = existing.raisedBy === actorId;
        const isEscalatedTo = existing.escalatedTo === actorId;
        const isCreator = event?.createdBy === actorId;
        const isManager = event?.assignedTo === actorId;
        if (!isPriv && !isRaiser && !isEscalatedTo && !isCreator && !isManager) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You are no longer authorised to act on this issue (it may have just been re-escalated).',
          });
        }

        // Resolve / re-open authorisation:
        //   · Only the escalated-to manager (or task creator/manager,
        //     or ADMIN/CMD) may RESOLVE — this is the meaningful work
        //     that makes the issue "done". A raiser-only resolve would
        //     defeat the audit trail (the raiser could silently close
        //     their own complaint).
        //   · The raiser should use `withdraw` instead — that's a
        //     separate mutation with its own audit / notification
        //     shape.
        if (input.status === 'RESOLVED') {
          if (isRaiser && !isEscalatedTo && !isCreator && !isManager && !isPriv) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the manager assigned to this issue can mark it resolved. To withdraw your own issue, use the Withdraw button instead.',
            });
          }
        }
        // CLOSED is reserved for the withdraw path; reject direct CLOSED via this endpoint.
        if (input.status === 'CLOSED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Use the Withdraw action to close an issue.',
          });
        }
        // SALES_STAFF / SD_JTO cannot resolve issues raised by others
        // (defence in depth — covered by the rule above too, but kept
        // explicit so the error message is clearer).
        if (input.status === 'RESOLVED' && !isRaiser
            && (actor.role === 'SALES_STAFF' || actor.role === 'SD_JTO')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only managers can resolve issues raised by other employees.',
          });
        }

        const currentTimeline = (existing.timeline as { action: string; performedBy: string; timestamp: string }[]) || [];
        const newTimeline = [
          ...currentTimeline,
          {
            action: `Status changed to ${input.status}${input.remarks ? `: ${input.remarks}` : ''}`,
            performedBy: actorId,
            timestamp: new Date().toISOString(),
          },
        ];

        const updateData: Record<string, unknown> = {
          status: input.status,
          timeline: newTimeline,
          updatedAt: new Date(),
        };
        if (input.status === 'RESOLVED') {
          updateData.resolvedBy = actorId;
          updateData.resolvedAt = new Date();
        }

        const [updated] = await tx.update(issues)
          .set(updateData)
          .where(eq(issues.id, input.id))
          .returning();

        await tx.insert(auditLogs).values({
          action: 'UPDATE_ISSUE_STATUS',
          entityType: 'ISSUE',
          entityId: input.id,
          performedBy: actorId,
          details: {
            status: input.status,
            remarks: input.remarks ?? null,
            previousStatus: existing.status,
          },
        });

        let createdNotificationId: string | null = null;
        if (input.status === 'RESOLVED' && existing.raisedBy !== actorId) {
          const [pref] = await tx.select({
            enabled: notificationPreferences.enabled,
          }).from(notificationPreferences).where(and(
            eq(notificationPreferences.employeeId, existing.raisedBy),
            eq(notificationPreferences.notificationType, 'ISSUE_RESOLVED'),
          )).limit(1);
          const enabled = pref?.enabled ?? true;
          if (enabled) {
            const [actorRow] = await tx.select({ name: employees.name })
              .from(employees).where(eq(employees.id, actorId)).limit(1);
            const dedupeKey = `ISSUE:${input.id}:ISSUE_RESOLVED:${actorId}`;
            const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);
            const [dup] = await tx.select({ id: notifications.id })
              .from(notifications).where(and(
                eq(notifications.recipientId, existing.raisedBy),
                eq(notifications.type, 'ISSUE_RESOLVED'),
                eq(notifications.dedupeKey, dedupeKey),
                gte(notifications.createdAt, windowStart),
              )).limit(1);
            if (!dup) {
              const title = 'Issue Resolved';
              const message = `Your ${existing.type} issue for "${event?.name ?? 'a task'}" has been resolved by ${actorRow?.name ?? 'a manager'}`;
              const [inserted] = await tx.insert(notifications).values({
                recipientId: existing.raisedBy,
                type: 'ISSUE_RESOLVED',
                title,
                message,
                entityType: 'ISSUE',
                entityId: input.id,
                metadata: {
                  issueType: existing.type,
                  eventName: event?.name ?? null,
                  resolvedByName: actorRow?.name ?? null,
                },
                dedupeKey,
              }).returning({ id: notifications.id });
              createdNotificationId = inserted?.id ?? null;
              if (createdNotificationId) {
                pushParams = {
                  notificationId: createdNotificationId,
                  recipientId: existing.raisedBy,
                  title,
                  message,
                };
              }
            }
          }
        }

        return { updated, createdNotificationId, pushParams };
      });

      if (result.pushParams) {
        await dispatchPushForNotification({
          notificationId: result.pushParams.notificationId,
          recipientId: result.pushParams.recipientId,
          type: 'ISSUE_RESOLVED',
          title: result.pushParams.title,
          message: result.pushParams.message,
          entityType: 'ISSUE',
          entityId: input.id,
        });
      }

      return result.updated;
    }),

  // Raiser-only "I withdraw this issue" — separate from updateStatus so
  // the auth predicate is dead simple (only the original raiser may
  // withdraw, and only while OPEN/IN_PROGRESS) and the timeline /
  // notification shape is clearly distinct from "manager resolved it".
  withdraw: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actorId = ctx.employeeId;

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        const [existing] = await tx.select().from(issues)
          .where(eq(issues.id, input.id)).for('update').limit(1);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Issue not found.' });
        }
        if (existing.raisedBy !== actorId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the original raiser can withdraw this issue.',
          });
        }
        if (existing.status === 'RESOLVED' || existing.status === 'CLOSED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This issue is already closed.',
          });
        }
        const [event] = await tx.select().from(events)
          .where(eq(events.id, existing.eventId)).limit(1);

        const currentTimeline = (existing.timeline as { action: string; performedBy: string; timestamp: string }[]) || [];
        const reasonSuffix = input.reason ? `: ${input.reason}` : '';
        const newTimeline = [
          ...currentTimeline,
          {
            action: `Issue withdrawn by raiser${reasonSuffix}`,
            performedBy: actorId,
            timestamp: new Date().toISOString(),
          },
        ];

        const [updated] = await tx.update(issues)
          .set({
            status: 'CLOSED',
            timeline: newTimeline,
            resolvedBy: actorId,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(issues.id, input.id))
          .returning();

        await tx.insert(auditLogs).values({
          action: 'WITHDRAW_ISSUE',
          entityType: 'ISSUE',
          entityId: input.id,
          performedBy: actorId,
          details: { reason: input.reason ?? null, previousStatus: existing.status },
        });

        // Notify the escalated-to manager (if any, and if not the actor)
        // so they know they no longer need to act on this issue.
        if (existing.escalatedTo && existing.escalatedTo !== actorId) {
          const [pref] = await tx.select({ enabled: notificationPreferences.enabled })
            .from(notificationPreferences).where(and(
              eq(notificationPreferences.employeeId, existing.escalatedTo),
              eq(notificationPreferences.notificationType, 'ISSUE_WITHDRAWN'),
            )).limit(1);
          if (pref?.enabled !== false) {
            const [actorRow] = await tx.select({ name: employees.name })
              .from(employees).where(eq(employees.id, actorId)).limit(1);
            const dedupeKey = `ISSUE:${input.id}:ISSUE_WITHDRAWN:${actorId}`;
            const title = 'Issue Withdrawn';
            const message = `${actorRow?.name ?? 'The raiser'} withdrew their ${existing.type} issue for "${event?.name ?? 'a task'}"`;
            const [inserted] = await tx.insert(notifications).values({
              recipientId: existing.escalatedTo,
              type: 'ISSUE_WITHDRAWN',
              title,
              message,
              entityType: 'ISSUE',
              entityId: input.id,
              metadata: {
                issueType: existing.type,
                eventName: event?.name ?? null,
                withdrawnByName: actorRow?.name ?? null,
              },
              dedupeKey,
            }).returning({ id: notifications.id });
            if (inserted?.id) {
              pushParams = {
                notificationId: inserted.id,
                recipientId: existing.escalatedTo,
                title,
                message,
              };
            }
          }
        }

        return { updated, pushParams };
      });

      if (result.pushParams) {
        await dispatchPushForNotification({
          notificationId: result.pushParams.notificationId,
          recipientId: result.pushParams.recipientId,
          type: 'ISSUE_WITHDRAWN',
          title: result.pushParams.title,
          message: result.pushParams.message,
          entityType: 'ISSUE',
          entityId: input.id,
        });
      }

      return result.updated;
    }),

  escalate: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      escalatedTo: z.string().uuid(),
      escalatedBy: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.escalatedBy && input.escalatedBy !== ctx.employeeId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only escalate issues as yourself.',
        });
      }
      const actorId = ctx.employeeId;

      await loadAndAuthorize(input.id, actorId);
      if (input.escalatedTo === actorId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot escalate an issue to yourself.' });
      }
      const [target] = await db.select({ id: employees.id, name: employees.name })
        .from(employees).where(eq(employees.id, input.escalatedTo)).limit(1);
      if (!target) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escalation target is not a valid employee.' });
      }

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        const [existing] = await tx.select().from(issues)
          .where(eq(issues.id, input.id)).for('update').limit(1);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Issue not found.' });
        }
        const [event] = await tx.select().from(events)
          .where(eq(events.id, existing.eventId)).limit(1);
        const [actor] = await tx.select({ role: employees.role })
          .from(employees).where(eq(employees.id, actorId)).limit(1);
        if (!actor) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session is no longer valid.' });
        }
        const isPriv = actor.role === 'ADMIN' || actor.role === 'CMD';
        const isRaiser = existing.raisedBy === actorId;
        const isEscalatedTo = existing.escalatedTo === actorId;
        const isCreator = event?.createdBy === actorId;
        const isManager = event?.assignedTo === actorId;
        if (!isPriv && !isRaiser && !isEscalatedTo && !isCreator && !isManager) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You are no longer authorised to escalate this issue.',
          });
        }
        if (input.escalatedTo === existing.raisedBy) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot escalate an issue back to its original raiser.' });
        }

        const currentTimeline = (existing.timeline as { action: string; performedBy: string; timestamp: string }[]) || [];
        const newTimeline = [
          ...currentTimeline,
          {
            action: `Escalated to ${target.name}`,
            performedBy: actorId,
            timestamp: new Date().toISOString(),
          },
        ];

        const [updated] = await tx.update(issues)
          .set({
            escalatedTo: input.escalatedTo,
            status: 'IN_PROGRESS',
            timeline: newTimeline,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, input.id))
          .returning();

        await tx.insert(auditLogs).values({
          action: 'ESCALATE_ISSUE',
          entityType: 'ISSUE',
          entityId: input.id,
          performedBy: actorId,
          details: {
            escalatedTo: input.escalatedTo,
            previousEscalatedTo: existing.escalatedTo,
          },
        });

        let createdNotificationId: string | null = null;
        const [pref] = await tx.select({
          enabled: notificationPreferences.enabled,
        }).from(notificationPreferences).where(and(
          eq(notificationPreferences.employeeId, input.escalatedTo),
          eq(notificationPreferences.notificationType, 'ISSUE_ESCALATED'),
        )).limit(1);
        const enabled = pref?.enabled ?? true;
        if (enabled) {
          const [actorRow] = await tx.select({ name: employees.name })
            .from(employees).where(eq(employees.id, actorId)).limit(1);
          const dedupeKey = `ISSUE:${input.id}:ISSUE_ESCALATED:${actorId}`;
          const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);
          const [dup] = await tx.select({ id: notifications.id })
            .from(notifications).where(and(
              eq(notifications.recipientId, input.escalatedTo),
              eq(notifications.type, 'ISSUE_ESCALATED'),
              eq(notifications.dedupeKey, dedupeKey),
              gte(notifications.createdAt, windowStart),
            )).limit(1);
          if (!dup) {
            const title = 'Issue Escalated to You';
            const message = `A ${existing.type} issue for "${event?.name ?? 'a task'}" has been escalated to you by ${actorRow?.name ?? 'a manager'}`;
            const [inserted] = await tx.insert(notifications).values({
              recipientId: input.escalatedTo,
              type: 'ISSUE_ESCALATED',
              title,
              message,
              entityType: 'ISSUE',
              entityId: input.id,
              metadata: {
                issueType: existing.type,
                eventName: event?.name ?? null,
                escalatedByName: actorRow?.name ?? null,
              },
              dedupeKey,
            }).returning({ id: notifications.id });
            createdNotificationId = inserted?.id ?? null;
            if (createdNotificationId) {
              pushParams = {
                notificationId: createdNotificationId,
                recipientId: input.escalatedTo,
                title,
                message,
              };
            }
          }
        }

        return { updated, createdNotificationId, pushParams };
      });

      if (result.pushParams) {
        await dispatchPushForNotification({
          notificationId: result.pushParams.notificationId,
          recipientId: result.pushParams.recipientId,
          type: 'ISSUE_ESCALATED',
          title: result.pushParams.title,
          message: result.pushParams.message,
          entityType: 'ISSUE',
          entityId: input.id,
        });
      }

      return result.updated;
    }),
});
