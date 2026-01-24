import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, resources, resourceAllocations, auditLogs } from "@/backend/db";

export const resourcesRouter = createTRPCRouter({
  getAll: publicProcedure
    .query(async () => {
      console.log("Fetching all resources");
      const results = await db.select().from(resources);
      return results;
    }),

  getByCircle: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching resources by circle:", input.circle);
      const result = await db.select().from(resources)
        .where(eq(resources.circle, input.circle));
      return result;
    }),

  getByType: publicProcedure
    .input(z.object({ type: z.enum(['SIM', 'FTTH']) }))
    .query(async ({ input }) => {
      console.log("Fetching resources by type:", input.type);
      const result = await db.select().from(resources)
        .where(eq(resources.type, input.type));
      return result;
    }),

  updateStock: publicProcedure
    .input(z.object({
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      type: z.enum(['SIM', 'FTTH']),
      total: z.number().min(0),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating resource stock:", input.circle, input.type);
      
      const existing = await db.select().from(resources)
        .where(and(
          eq(resources.circle, input.circle),
          eq(resources.type, input.type)
        ));

      let result;
      if (existing[0]) {
        const newRemaining = input.total - existing[0].allocated;
        result = await db.update(resources)
          .set({
            total: input.total,
            remaining: newRemaining > 0 ? newRemaining : 0,
            updatedAt: new Date(),
          })
          .where(eq(resources.id, existing[0].id))
          .returning();
      } else {
        result = await db.insert(resources).values({
          type: input.type,
          circle: input.circle,
          total: input.total,
          allocated: 0,
          used: 0,
          remaining: input.total,
        }).returning();
      }

      await db.insert(auditLogs).values({
        action: 'UPDATE_RESOURCE_STOCK',
        entityType: 'RESOURCE',
        entityId: result[0].id,
        performedBy: input.updatedBy,
        details: { 
          circle: input.circle,
          type: input.type,
          total: input.total,
        },
      });

      return result[0];
    }),

  allocateToEvent: publicProcedure
    .input(z.object({
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      type: z.enum(['SIM', 'FTTH']),
      eventId: z.string().uuid(),
      quantity: z.number().min(1),
      allocatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Allocating resources to event:", input.eventId);
      
      const resource = await db.select().from(resources)
        .where(and(
          eq(resources.circle, input.circle),
          eq(resources.type, input.type)
        ));

      if (!resource[0]) {
        throw new Error("Resource not found");
      }

      if (resource[0].remaining < input.quantity) {
        throw new Error("Insufficient resources available");
      }

      const newAllocated = resource[0].allocated + input.quantity;
      const newRemaining = resource[0].remaining - input.quantity;

      await db.update(resources)
        .set({
          allocated: newAllocated,
          remaining: newRemaining,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, resource[0].id));

      const allocation = await db.insert(resourceAllocations).values({
        resourceId: resource[0].id,
        eventId: input.eventId,
        quantity: input.quantity,
        allocatedBy: input.allocatedBy,
      }).returning();

      await db.insert(auditLogs).values({
        action: 'ALLOCATE_RESOURCE',
        entityType: 'RESOURCE',
        entityId: resource[0].id,
        performedBy: input.allocatedBy,
        details: { 
          eventId: input.eventId,
          quantity: input.quantity,
          type: input.type,
        },
      });

      return allocation[0];
    }),

  recordUsage: publicProcedure
    .input(z.object({
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      type: z.enum(['SIM', 'FTTH']),
      quantity: z.number().min(1),
      recordedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Recording resource usage:", input.circle, input.type);
      
      const resource = await db.select().from(resources)
        .where(and(
          eq(resources.circle, input.circle),
          eq(resources.type, input.type)
        ));

      if (!resource[0]) {
        throw new Error("Resource not found");
      }

      const newUsed = resource[0].used + input.quantity;

      const result = await db.update(resources)
        .set({
          used: newUsed,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, resource[0].id))
        .returning();

      return result[0];
    }),

  getAllocations: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching allocations for event:", input.eventId);
      const result = await db.select().from(resourceAllocations)
        .where(eq(resourceAllocations.eventId, input.eventId))
        .orderBy(desc(resourceAllocations.allocatedAt));
      return result;
    }),

  getSummary: publicProcedure
    .query(async () => {
      console.log("Fetching resource summary");
      const allResources = await db.select().from(resources);
      
      const summary = {
        SIM: { total: 0, allocated: 0, used: 0, remaining: 0 },
        FTTH: { total: 0, allocated: 0, used: 0, remaining: 0 },
      };

      for (const resource of allResources) {
        summary[resource.type].total += resource.total;
        summary[resource.type].allocated += resource.allocated;
        summary[resource.type].used += resource.used;
        summary[resource.type].remaining += resource.remaining;
      }

      return summary;
    }),
});
