import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, issues, auditLogs, employees, events } from "@/backend/db";
import { notifyIssueRaised, notifyIssueResolved, notifyIssueStatusChanged } from "@/backend/services/notification.service";

export const issuesRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      eventId: z.string().uuid().optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all issues", input);
      const results = await db.select().from(issues).orderBy(desc(issues.createdAt));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching issue by id:", input.id);
      const result = await db.select().from(issues).where(eq(issues.id, input.id));
      return result[0] || null;
    }),

  getByEvent: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching issues by event:", input.eventId);
      const result = await db.select().from(issues)
        .where(eq(issues.eventId, input.eventId))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  getByRaisedBy: publicProcedure
    .input(z.object({ raisedBy: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching issues raised by:", input.raisedBy);
      const result = await db.select().from(issues)
        .where(eq(issues.raisedBy, input.raisedBy))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  getByStatus: publicProcedure
    .input(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }))
    .query(async ({ input }) => {
      console.log("Fetching issues by status:", input.status);
      const result = await db.select().from(issues)
        .where(eq(issues.status, input.status))
        .orderBy(desc(issues.createdAt));
      return result;
    }),

  create: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      raisedBy: z.string().uuid(),
      type: z.enum(['MATERIAL_SHORTAGE', 'SITE_ACCESS', 'EQUIPMENT', 'NETWORK_PROBLEM', 'OTHER']),
      description: z.string().min(1),
      escalatedTo: z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating issue for event:", input.eventId);
      
      const timeline = [{
        action: 'Issue Created',
        performedBy: input.raisedBy,
        timestamp: new Date().toISOString(),
      }];

      const result = await db.insert(issues).values({
        eventId: input.eventId,
        raisedBy: input.raisedBy,
        type: input.type,
        description: input.description,
        escalatedTo: input.escalatedTo,
        timeline: timeline,
      }).returning();

      await db.insert(auditLogs).values({
        action: 'CREATE_ISSUE',
        entityType: 'ISSUE',
        entityId: result[0].id,
        performedBy: input.raisedBy,
        details: { 
          eventId: input.eventId,
          type: input.type,
        },
      });

      // Notify escalated person about the issue
      if (input.escalatedTo) {
        const raisedByEmployee = await db.select().from(employees).where(eq(employees.id, input.raisedBy));
        const event = await db.select().from(events).where(eq(events.id, input.eventId));
        const raisedByName = raisedByEmployee[0]?.name || 'Team Member';
        const eventName = event[0]?.name || 'Unknown Event';
        await notifyIssueRaised(input.escalatedTo, result[0].id, input.type, eventName, raisedByName);
      }

      return result[0];
    }),

  updateStatus: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
      updatedBy: z.string().uuid(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating issue status:", input.id);
      
      const existing = await db.select().from(issues).where(eq(issues.id, input.id));
      if (!existing[0]) {
        throw new Error("Issue not found");
      }

      const currentTimeline = (existing[0].timeline as { action: string; performedBy: string; timestamp: string }[]) || [];
      const newTimeline = [
        ...currentTimeline,
        {
          action: `Status changed to ${input.status}${input.remarks ? `: ${input.remarks}` : ''}`,
          performedBy: input.updatedBy,
          timestamp: new Date().toISOString(),
        },
      ];

      const updateData: Record<string, unknown> = {
        status: input.status,
        timeline: newTimeline,
        updatedAt: new Date(),
      };

      if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
        updateData.resolvedBy = input.updatedBy;
        updateData.resolvedAt = new Date();
      }

      const result = await db.update(issues)
        .set(updateData)
        .where(eq(issues.id, input.id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_ISSUE_STATUS',
        entityType: 'ISSUE',
        entityId: input.id,
        performedBy: input.updatedBy,
        details: { status: input.status },
      });

      // Notify issue raiser when resolved
      if ((input.status === 'RESOLVED' || input.status === 'CLOSED') && existing[0].raisedBy !== input.updatedBy) {
        const updatedByEmployee = await db.select().from(employees).where(eq(employees.id, input.updatedBy));
        const resolvedByName = updatedByEmployee[0]?.name || 'Manager';
        await notifyIssueResolved(existing[0].raisedBy, input.id, existing[0].type, resolvedByName);
      } else if (input.status !== 'RESOLVED' && input.status !== 'CLOSED') {
        // Notify about status change
        const updatedByEmployee = await db.select().from(employees).where(eq(employees.id, input.updatedBy));
        const changedByName = updatedByEmployee[0]?.name || 'Manager';
        
        // Notify the person who raised the issue
        if (existing[0].raisedBy !== input.updatedBy) {
          await notifyIssueStatusChanged(existing[0].raisedBy, input.id, input.status, changedByName);
        }
        // Also notify escalated person if different
        if (existing[0].escalatedTo && existing[0].escalatedTo !== input.updatedBy && existing[0].escalatedTo !== existing[0].raisedBy) {
          await notifyIssueStatusChanged(existing[0].escalatedTo, input.id, input.status, changedByName);
        }
      }

      return result[0];
    }),

  escalate: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      escalatedTo: z.string().uuid(),
      escalatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Escalating issue:", input.id);
      
      const existing = await db.select().from(issues).where(eq(issues.id, input.id));
      if (!existing[0]) {
        throw new Error("Issue not found");
      }

      const currentTimeline = (existing[0].timeline as { action: string; performedBy: string; timestamp: string }[]) || [];
      const newTimeline = [
        ...currentTimeline,
        {
          action: `Escalated to ${input.escalatedTo}`,
          performedBy: input.escalatedBy,
          timestamp: new Date().toISOString(),
        },
      ];

      const result = await db.update(issues)
        .set({
          escalatedTo: input.escalatedTo,
          status: 'IN_PROGRESS',
          timeline: newTimeline,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, input.id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'ESCALATE_ISSUE',
        entityType: 'ISSUE',
        entityId: input.id,
        performedBy: input.escalatedBy,
        details: { escalatedTo: input.escalatedTo },
      });

      // Notify the new escalated person
      const escalatedByEmployee = await db.select().from(employees).where(eq(employees.id, input.escalatedBy));
      const event = await db.select().from(events).where(eq(events.id, existing[0].eventId));
      const escalatedByName = escalatedByEmployee[0]?.name || 'Manager';
      const eventName = event[0]?.name || 'Unknown Event';
      await notifyIssueRaised(input.escalatedTo, input.id, existing[0].type, eventName, escalatedByName);

      return result[0];
    }),

  getOpenCount: publicProcedure
    .query(async () => {
      console.log("Fetching open issues count");
      const result = await db.select().from(issues)
        .where(eq(issues.status, 'OPEN'));
      return result.length;
    }),
});
