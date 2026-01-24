import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../create-context';
import { db, notifications, pushTokens } from '@/backend/db';
import { eq, and, desc, sql, lt } from 'drizzle-orm';
import { getUnreadCountOptimized, cleanupOldNotifications, cleanupInactivePushTokens } from '@/backend/services/notification.service';

export const notificationsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;
      console.log('Fetching notifications for employee:', employeeId);
      
      let query = db.select()
        .from(notifications)
        .where(eq(notifications.recipientId, employeeId))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);

      if (input.unreadOnly) {
        query = db.select()
          .from(notifications)
          .where(and(
            eq(notifications.recipientId, employeeId),
            eq(notifications.isRead, false)
          ))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit);
      }

      const result = await query;
      return result;
    }),

  getUnreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const employeeId = ctx.employeeId;
      const count = await getUnreadCountOptimized(employeeId);
      return { count };
    }),

  markAsRead: protectedProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;
      console.log('Marking notification as read:', input.notificationId);
      
      const result = await db.update(notifications)
        .set({ 
          isRead: true, 
          readAt: new Date() 
        })
        .where(and(
          eq(notifications.id, input.notificationId),
          eq(notifications.recipientId, employeeId)
        ))
        .returning();
      
      return result[0];
    }),

  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const employeeId = ctx.employeeId;
      console.log('Marking all notifications as read for employee:', employeeId);
      
      await db.update(notifications)
        .set({ 
          isRead: true, 
          readAt: new Date() 
        })
        .where(and(
          eq(notifications.recipientId, employeeId),
          eq(notifications.isRead, false)
        ));
      
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;
      console.log('Deleting notification:', input.notificationId);
      
      await db.delete(notifications)
        .where(and(
          eq(notifications.id, input.notificationId),
          eq(notifications.recipientId, employeeId)
        ));
      
      return { success: true };
    }),

  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string(),
      platform: z.enum(['ios', 'android', 'web']),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;
      console.log('Registering push token for employee:', employeeId);
      
      const existing = await db.select()
        .from(pushTokens)
        .where(and(
          eq(pushTokens.employeeId, employeeId),
          eq(pushTokens.token, input.token)
        ));

      if (existing.length > 0) {
        await db.update(pushTokens)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(pushTokens.id, existing[0].id));
        return existing[0];
      }

      const result = await db.insert(pushTokens).values({
        employeeId: employeeId,
        token: input.token,
        platform: input.platform,
      }).returning();

      return result[0];
    }),

  unregisterPushToken: protectedProcedure
    .input(z.object({
      token: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;
      console.log('Unregistering push token:', input.token);
      
      await db.update(pushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(pushTokens.token, input.token),
          eq(pushTokens.employeeId, employeeId)
        ));
      
      return { success: true };
    }),
});
