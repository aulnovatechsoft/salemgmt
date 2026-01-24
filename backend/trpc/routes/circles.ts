import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, circles } from "@/backend/db";

export const circlesRouter = createTRPCRouter({
  getAll: publicProcedure
    .query(async () => {
      console.log("Fetching all circles");
      const results = await db.select().from(circles)
        .where(eq(circles.isActive, true))
        .orderBy(asc(circles.label));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching circle by id:", input.id);
      const result = await db.select().from(circles)
        .where(eq(circles.id, input.id));
      return result[0] || null;
    }),

  getByValue: publicProcedure
    .input(z.object({ value: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching circle by value:", input.value);
      const result = await db.select().from(circles)
        .where(eq(circles.value, input.value));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      value: z.string().min(1),
      label: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating circle:", input.value);
      const result = await db.insert(circles).values({
        value: input.value,
        label: input.label,
      }).returning();
      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      value: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating circle:", input.id);
      const { id, ...updateData } = input;
      const result = await db.update(circles)
        .set(updateData)
        .where(eq(circles.id, id))
        .returning();
      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      console.log("Deleting circle:", input.id);
      const result = await db.update(circles)
        .set({ isActive: false })
        .where(eq(circles.id, input.id))
        .returning();
      return result[0];
    }),
});
