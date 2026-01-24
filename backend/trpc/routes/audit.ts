import { z } from "zod";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, auditLogs } from "@/backend/db";

export const auditRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      entityType: z.enum(['EVENT', 'SALES', 'RESOURCE', 'ISSUE', 'EMPLOYEE']).optional(),
      performedBy: z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching audit logs", input);
      const limit = input?.limit || 50;
      const results = await db.select().from(auditLogs)
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit);
      return results;
    }),

  getByEntity: publicProcedure
    .input(z.object({ 
      entityType: z.enum(['EVENT', 'SALES', 'RESOURCE', 'ISSUE', 'EMPLOYEE']),
      entityId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching audit logs for entity:", input.entityType, input.entityId);
      const result = await db.select().from(auditLogs)
        .where(and(
          eq(auditLogs.entityType, input.entityType),
          eq(auditLogs.entityId, input.entityId)
        ))
        .orderBy(desc(auditLogs.timestamp));
      return result;
    }),

  getByPerformer: publicProcedure
    .input(z.object({ performedBy: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching audit logs by performer:", input.performedBy);
      const result = await db.select().from(auditLogs)
        .where(eq(auditLogs.performedBy, input.performedBy))
        .orderBy(desc(auditLogs.timestamp));
      return result;
    }),

  getByAction: publicProcedure
    .input(z.object({ action: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching audit logs by action:", input.action);
      const result = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, input.action))
        .orderBy(desc(auditLogs.timestamp));
      return result;
    }),

  create: publicProcedure
    .input(z.object({
      action: z.string(),
      entityType: z.enum(['EVENT', 'SALES', 'RESOURCE', 'ISSUE', 'EMPLOYEE']),
      entityId: z.string().uuid(),
      performedBy: z.string().uuid(),
      details: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating audit log:", input.action);
      const result = await db.insert(auditLogs).values({
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        performedBy: input.performedBy,
        details: input.details || {},
      }).returning();

      return result[0];
    }),

  getRecent: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      console.log("Fetching recent audit logs");
      const result = await db.select().from(auditLogs)
        .orderBy(desc(auditLogs.timestamp))
        .limit(input.limit);
      return result;
    }),
});
