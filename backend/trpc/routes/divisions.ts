import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, divisionMaster } from "@/backend/db";

export const divisionsRouter = createTRPCRouter({
  getAll: publicProcedure
    .query(async () => {
      console.log("Fetching all divisions");
      const results = await db.select().from(divisionMaster)
        .where(eq(divisionMaster.isActive, true))
        .orderBy(asc(divisionMaster.divisionName));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      console.log("Fetching division by id:", input.id);
      const result = await db.select().from(divisionMaster)
        .where(eq(divisionMaster.divisionId, input.id));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      divisionId: z.number(),
      divisionName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating division:", input.divisionName);
      const result = await db.insert(divisionMaster).values({
        divisionId: input.divisionId,
        divisionName: input.divisionName,
      }).returning();
      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      divisionId: z.number(),
      divisionName: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating division:", input.divisionId);
      const { divisionId, ...updateData } = input;
      const result = await db.update(divisionMaster)
        .set(updateData)
        .where(eq(divisionMaster.divisionId, divisionId))
        .returning();
      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ divisionId: z.number() }))
    .mutation(async ({ input }) => {
      console.log("Deleting division:", input.divisionId);
      const result = await db.update(divisionMaster)
        .set({ isActive: false })
        .where(eq(divisionMaster.divisionId, input.divisionId))
        .returning();
      return result[0];
    }),
});
