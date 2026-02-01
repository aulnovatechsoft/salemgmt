import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../create-context';
import { db, notifications, pushTokens, notificationPreferences } from '@/backend/db';
import { eq, and, desc, sql, lt, inArray } from 'drizzle-orm';
import { getUnreadCountOptimized, cleanupOldNotifications, cleanupInactivePushTokens } from '@/backend/services/notification.service';

const NOTIFICATION_TYPES = [
  'EVENT_ASSIGNED',
  'EVENT_STATUS_CHANGED',
  'ISSUE_RAISED',
  'ISSUE_ESCALATED',
  'ISSUE_RESOLVED',
  'ISSUE_STATUS_CHANGED',
  'SUBTASK_ASSIGNED',
  'SUBTASK_DUE_SOON',
  'SUBTASK_OVERDUE',
  'SUBTASK_COMPLETED',
  'TASK_SUBMITTED',
  'TASK_APPROVED',
  'TASK_REJECTED',
  'SLA_WARNING',
  'SLA_BREACHED',
  'DEADLINE_WARNING',
  'TASK_ENDING_TODAY'
] as const;

export const notificationsRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      console.log('Fetching notifications for employee:', employeeId);
      
      if (input.unreadOnly) {
        const result = await db.select()
          .from(notifications)
          .where(and(
            eq(notifications.recipientId, employeeId),
            eq(notifications.isRead, false)
          ))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit);
        return result;
      }

      const result = await db.select()
        .from(notifications)
        .where(eq(notifications.recipientId, employeeId))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);
      return result;
    }),

  getUnreadCount: publicProcedure
    .query(async ({ ctx }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        return { count: 0 };
      }
      const count = await getUnreadCountOptimized(employeeId);
      return { count };
    }),

  markAsRead: publicProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
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

  markAllAsRead: publicProcedure
    .mutation(async ({ ctx }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
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

  delete: publicProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      console.log('Deleting notification:', input.notificationId);
      
      await db.delete(notifications)
        .where(and(
          eq(notifications.id, input.notificationId),
          eq(notifications.recipientId, employeeId)
        ));
      
      return { success: true };
    }),

  registerPushToken: publicProcedure
    .input(z.object({
      token: z.string(),
      platform: z.enum(['ios', 'android', 'web']),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
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

  unregisterPushToken: publicProcedure
    .input(z.object({
      token: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      console.log('Unregistering push token:', input.token);
      
      await db.update(pushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(pushTokens.token, input.token),
          eq(pushTokens.employeeId, employeeId)
        ));
      
      return { success: true };
    }),

  getPreferences: publicProcedure
    .query(async ({ ctx }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      
      const prefs = await db.select().from(notificationPreferences)
        .where(eq(notificationPreferences.employeeId, employeeId));
      
      const prefMap = new Map(prefs.map(p => [p.notificationType, p]));
      
      return NOTIFICATION_TYPES.map(type => ({
        notificationType: type,
        enabled: prefMap.get(type)?.enabled ?? true,
        pushEnabled: prefMap.get(type)?.pushEnabled ?? true,
      }));
    }),

  updatePreference: publicProcedure
    .input(z.object({
      notificationType: z.enum(NOTIFICATION_TYPES),
      enabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      
      const existing = await db.select().from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.employeeId, employeeId),
          eq(notificationPreferences.notificationType, input.notificationType)
        ));
      
      if (existing[0]) {
        const updateValues: Record<string, unknown> = { updatedAt: new Date() };
        if (input.enabled !== undefined) updateValues.enabled = input.enabled;
        if (input.pushEnabled !== undefined) updateValues.pushEnabled = input.pushEnabled;
        
        const result = await db.update(notificationPreferences)
          .set(updateValues)
          .where(eq(notificationPreferences.id, existing[0].id))
          .returning();
        return result[0];
      }
      
      const result = await db.insert(notificationPreferences).values({
        employeeId,
        notificationType: input.notificationType,
        enabled: input.enabled ?? true,
        pushEnabled: input.pushEnabled ?? true,
      }).returning();
      
      return result[0];
    }),

  updateAllPreferences: publicProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.req.headers.get('x-employee-id');
      if (!employeeId) {
        throw new Error('Employee ID required');
      }
      
      for (const type of NOTIFICATION_TYPES) {
        const existing = await db.select().from(notificationPreferences)
          .where(and(
            eq(notificationPreferences.employeeId, employeeId),
            eq(notificationPreferences.notificationType, type)
          ));
        
        if (existing[0]) {
          const updateValues: Record<string, unknown> = { updatedAt: new Date() };
          if (input.enabled !== undefined) updateValues.enabled = input.enabled;
          if (input.pushEnabled !== undefined) updateValues.pushEnabled = input.pushEnabled;
          
          await db.update(notificationPreferences)
            .set(updateValues)
            .where(eq(notificationPreferences.id, existing[0].id));
        } else {
          await db.insert(notificationPreferences).values({
            employeeId,
            notificationType: type,
            enabled: input.enabled ?? true,
            pushEnabled: input.pushEnabled ?? true,
          });
        }
      }
      
      return { success: true };
    }),
});
