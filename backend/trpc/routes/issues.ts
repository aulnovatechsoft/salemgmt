import { z } from "zod";
import { eq, and, desc, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "../create-context";
import { db, issues, auditLogs, events, employees, notifications, notificationPreferences } from "@/backend/db";
import { dispatchPushForNotification } from "@/backend/services/notification.service";
import { allocateIssueDisplayId } from "@/backend/db/issueIdAllocator";

// 5-minute dedupe window — matches the in-tx pattern used elsewhere
// (see submitTaskForReview). Same value as DEDUPE_WINDOW_MS in the
// notification service.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

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

export const issuesRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────
  // All queries require auth so anonymous callers can't pull issue data.
  // (Per-recipient filtering for getAll is part of the High-severity sprint;
  // this Critical pass only locks down the writes + auth boundary.)

  getAll: authedProcedure
    .input(z.object({
      eventId: z.string().uuid().optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all issues", input);
      // Honour input filters that were previously silently ignored.
      const conds = [] as any[];
      if (input?.eventId) conds.push(eq(issues.eventId, input.eventId));
      if (input?.status) conds.push(eq(issues.status, input.status));
      const q = db.select().from(issues);
      const results = conds.length > 0
        ? await q.where(and(...conds)).orderBy(desc(issues.createdAt))
        : await q.orderBy(desc(issues.createdAt));
      return results;
    }),

  getById: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await db.select().from(issues).where(eq(issues.id, input.id));
      return result[0] || null;
    }),

  getByEvent: authedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await db.select().from(issues)
        .where(eq(issues.eventId, input.eventId))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  getByRaisedBy: authedProcedure
    .input(z.object({ raisedBy: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      // A user can only query their own raised-issues list. Privileged
      // roles (ADMIN/CMD) can query anyone's. Otherwise we'd leak the
      // count + content of issues raised by other employees.
      if (input.raisedBy !== ctx.employeeId) {
        const [actor] = await db.select({ role: employees.role })
          .from(employees).where(eq(employees.id, ctx.employeeId)).limit(1);
        if (!actor || (actor.role !== 'ADMIN' && actor.role !== 'CMD')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own raised issues.' });
        }
      }
      const result = await db.select().from(issues)
        .where(eq(issues.raisedBy, input.raisedBy))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  getByStatus: authedProcedure
    .input(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }))
    .query(async ({ input }) => {
      const result = await db.select().from(issues)
        .where(eq(issues.status, input.status))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  getOpenCount: authedProcedure
    .query(async () => {
      const result = await db.select().from(issues)
        .where(eq(issues.status, 'OPEN'));
      return result.length;
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  create: authedProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      // Legacy: clients may still send their own id. Authority comes from
      // ctx.employeeId — input is accepted only if it matches the session.
      raisedBy: z.string().uuid().optional(),
      type: z.enum(['MATERIAL_SHORTAGE', 'SITE_ACCESS', 'EQUIPMENT', 'NETWORK_PROBLEM', 'OTHER']),
      description: z.string().min(1),
      escalatedTo: z.string().uuid().optional().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.raisedBy && input.raisedBy !== ctx.employeeId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only raise issues as yourself.',
        });
      }
      const actorId = ctx.employeeId;

      // Validate event exists (also gives us the creator for escalation
      // fallback + the in-tx notification recipient).
      const [eventRow] = await db.select().from(events)
        .where(eq(events.id, input.eventId)).limit(1);
      if (!eventRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found.' });
      }

      // Validate the explicit escalation target if the client sent one.
      // The raise-issue form auto-fills `escalatedTo` with `event.createdBy`,
      // which equals the actor whenever a manager raises an issue on their
      // OWN task — a common, valid case. Treat self-escalation as "no
      // escalation" (silently drop) instead of rejecting, so the form keeps
      // working for creator-as-raiser. Same with target-equals-original-
      // raiser at create time (raisedBy === actor here, so this is the
      // same case).
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
        // Fall back to the task creator only if it isn't the actor themselves.
        escalateTargetId = eventRow.createdBy;
      }

      // Final fallback: when the raiser IS the task creator (manager
      // raising on their own task), there's no upstream creator to
      // escalate to. Walk one step up the reporting chain via the
      // raiser's `reportingPersNo` → resolve to the manager's
      // `employees.id`. Without this, self-created issues end up with
      // `escalatedTo = null` and only the raiser sees them — defeating
      // the purpose of "Raise Issue" (which the form's info banner
      // describes as "escalated to your task manager or reporting
      // manager for resolution").
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

      // ────────────────────────────────────────────────────────────────────
      // Wrap the insert + audit + notification in a SINGLE transaction.
      // Same production-grade pattern as submitTaskForReview: a server
      // restart between the insert and the notification fan-out must
      // never leave the issue created but the manager's bell silent.
      // Push dispatch is best-effort and stays outside the tx (so an
      // Expo / network outage never rolls back a successful issue create).
      // ────────────────────────────────────────────────────────────────────
      // Allocate a human-friendly display id (ISS-YYYY-MM-NNNN). Done
      // OUTSIDE the tx because the allocator is its own atomic
      // upsert+returning sequence — and a tx rollback should NOT free
      // the sequence number (matches how task display ids work for events).
      const displayId = await allocateIssueDisplayId();

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        const timeline = [{
          action: 'Issue Created',
          performedBy: actorId,
          timestamp: new Date().toISOString(),
        }];

        const [created] = await tx.insert(issues).values({
          displayId,
          eventId: input.eventId,
          raisedBy: actorId,
          type: input.type,
          description: input.description,
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
            escalatedTo: escalateTargetId,
          },
        });

        // Bell notification (in-tx, atomic with the insert).
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
            // Include actor in dedupeKey so two different raisers can each
            // notify the same manager about the same event within the
            // 5-min window without colliding (matches submit-for-review
            // dedupe pattern).
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

      // Push dispatch — outside tx, best-effort. The bell row is durable;
      // a push outage must never roll back a successful issue create.
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
      // Legacy field retained for client compatibility; ignored if it
      // doesn't match ctx.employeeId.
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

      // Friendly pre-tx authorization probe (cheap, gives nice error
      // messages without opening a tx). The authoritative check is the
      // re-read with `for update` inside the tx below — that closes the
      // TOCTOU window where a concurrent escalation/close could otherwise
      // slip past the outer check.
      await loadAndAuthorize(input.id, actorId);

      type PushParams = { notificationId: string; recipientId: string; title: string; message: string };
      const result = await db.transaction(async (tx) => {
        let pushParams: PushParams | null = null;
        // ── In-tx authorization re-check with row lock ──────────────────
        // SELECT ... FOR UPDATE on the issue row blocks any concurrent
        // escalation/status change until this tx commits or rolls back.
        // We then re-evaluate the same authorization predicate against
        // the now-locked row. If a concurrent escalation has changed
        // `escalatedTo` away from the actor (and the actor wasn't the
        // raiser/creator/manager/admin), this throws FORBIDDEN before
        // any UPDATE runs.
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
        // SALES_STAFF / SD_JTO cannot resolve issues raised by others.
        if (!isRaiser && (actor.role === 'SALES_STAFF' || actor.role === 'SD_JTO')) {
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
        if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
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

        // Resolution notification (in-tx, atomic). Skip when the actor is
        // notifying themselves (raiser self-resolves their own issue).
        let createdNotificationId: string | null = null;
        if ((input.status === 'RESOLVED' || input.status === 'CLOSED')
            && existing.raisedBy !== actorId) {
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

  escalate: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      escalatedTo: z.string().uuid(),
      // Legacy field — ignored if it doesn't match ctx.employeeId.
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

      // Friendly pre-tx authorization probe + target validation. The
      // authoritative auth check is the FOR UPDATE re-read inside the tx
      // below — that closes the TOCTOU window where a concurrent
      // escalation could otherwise change `escalatedTo` between this
      // check and the UPDATE.
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
        // ── In-tx authorization re-check with row lock ──────────────────
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
        // Re-validate target against the locked row (raisedBy is immutable
        // but defensive coding keeps the invariant explicit).
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

        // Escalation notification (in-tx, atomic).
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
