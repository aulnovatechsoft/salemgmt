import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, roles } from "@/backend/db";

export const rolesRouter = createTRPCRouter({
  getAll: publicProcedure
    .query(async () => {
      console.log("Fetching all roles");
      const results = await db.select().from(roles)
        .where(eq(roles.isActive, true))
        .orderBy(asc(roles.hierarchy));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching role by id:", input.id);
      const result = await db.select().from(roles)
        .where(eq(roles.id, input.id));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      value: z.string().min(1),
      label: z.string().min(1),
      hierarchy: z.number().min(1),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating role:", input.value);
      const result = await db.insert(roles).values({
        value: input.value,
        label: input.label,
        hierarchy: input.hierarchy,
      }).returning();
      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      value: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      hierarchy: z.number().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating role:", input.id);
      const { id, ...updateData } = input;
      const result = await db.update(roles)
        .set(updateData)
        .where(eq(roles.id, id))
        .returning();
      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      console.log("Deleting role:", input.id);
      const result = await db.update(roles)
        .set({ isActive: false })
        .where(eq(roles.id, input.id))
        .returning();
      return result[0];
    }),
});
