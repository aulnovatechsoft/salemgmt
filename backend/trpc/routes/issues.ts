import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, issues, auditLogs, events, employees } from "@/backend/db";
import { notifyIssueRaised, notifyIssueResolved, notifyIssueEscalated } from "@/backend/services/notification.service";

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
      escalatedTo: z.string().uuid().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating issue for event:", input.eventId);
      console.log("Issue input:", JSON.stringify(input, null, 2));
      
      const timeline = [{
        action: 'Issue Created',
        performedBy: input.raisedBy,
        timestamp: new Date().toISOString(),
      }];

      try {
        const result = await db.insert(issues).values({
          eventId: input.eventId,
          raisedBy: input.raisedBy,
          type: input.type,
          description: input.description,
          escalatedTo: input.escalatedTo || null,
          timeline: timeline,
        }).returning();

        console.log("Issue created successfully:", result[0]?.id);

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

        // Send notification to task creator
        try {
          const event = await db.select().from(events)
            .where(eq(events.id, input.eventId));
          const raiser = await db.select().from(employees)
            .where(eq(employees.id, input.raisedBy));
          
          if (event[0] && raiser[0]) {
            await notifyIssueRaised(
              event[0].createdBy,
              result[0].id,
              input.type,
              event[0].name,
              raiser[0].name
            );
            console.log("Issue notification sent to task creator:", event[0].createdBy);
          }
        } catch (notifError) {
          console.error("Failed to send issue notification:", notifError);
        }

        return result[0];
      } catch (error: any) {
        console.error("Error creating issue:", error.message);
        throw new Error(`Failed to create issue: ${error.message}`);
      }
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

      // Send notification when issue is resolved
      if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
        try {
          const event = await db.select().from(events)
            .where(eq(events.id, existing[0].eventId));
          const resolver = await db.select().from(employees)
            .where(eq(employees.id, input.updatedBy));
          
          if (event[0] && resolver[0]) {
            await notifyIssueResolved(
              existing[0].raisedBy,
              input.id,
              existing[0].type,
              event[0].name,
              resolver[0].name
            );
            console.log("Issue resolution notification sent to raiser:", existing[0].raisedBy);
          }
        } catch (notifError) {
          console.error("Failed to send issue resolution notification:", notifError);
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

      // Send notification to the person the issue is escalated to
      try {
        const event = await db.select().from(events)
          .where(eq(events.id, existing[0].eventId));
        const escalator = await db.select().from(employees)
          .where(eq(employees.id, input.escalatedBy));
        
        if (event[0] && escalator[0]) {
          await notifyIssueEscalated(
            input.escalatedTo,
            input.id,
            existing[0].type,
            event[0].name,
            escalator[0].name
          );
          console.log("Issue escalation notification sent to:", input.escalatedTo);
        }
      } catch (notifError) {
        console.error("Failed to send issue escalation notification:", notifError);
      }

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
