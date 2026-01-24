import { db } from '../db';
import { notifications, pushTokens } from '../db/schema';
import { eq, and, desc, sql, lt, gte } from 'drizzle-orm';

type NotificationType = 
  | 'EVENT_ASSIGNED'
  | 'EVENT_STATUS_CHANGED'
  | 'ISSUE_RAISED'
  | 'ISSUE_ESCALATED'
  | 'ISSUE_RESOLVED'
  | 'ISSUE_STATUS_CHANGED'
  | 'SUBTASK_ASSIGNED'
  | 'SUBTASK_DUE_SOON'
  | 'SUBTASK_OVERDUE'
  | 'SUBTASK_COMPLETED';

interface CreateNotificationParams {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

interface PushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const MAX_PUSH_BATCH_SIZE = 100;
const MAX_FAILURE_COUNT = 3;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

async function sendExpoPushNotificationsBatch(messages: PushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  
  const tickets: ExpoPushTicket[] = [];
  
  for (let i = 0; i < messages.length; i += MAX_PUSH_BATCH_SIZE) {
    const batch = messages.slice(i, i + MAX_PUSH_BATCH_SIZE);
    
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        console.error('Expo push API error:', response.status, await response.text());
        continue;
      }

      const result = await response.json();
      const batchTickets = result.data || [];
      tickets.push(...batchTickets);
      
      console.log(`Push batch sent: ${batch.length} messages, ${batchTickets.length} tickets`);
    } catch (error) {
      console.error('Failed to send push notification batch:', error);
    }
  }
  
  return tickets;
}

async function handlePushTickets(
  tickets: ExpoPushTicket[], 
  tokenRecords: Array<{ id: string; token: string; failureCount: number }>
): Promise<void> {
  for (let i = 0; i < tickets.length && i < tokenRecords.length; i++) {
    const ticket = tickets[i];
    const tokenRecord = tokenRecords[i];
    
    if (ticket.status === 'error') {
      const newFailureCount = tokenRecord.failureCount + 1;
      
      if (ticket.details?.error === 'DeviceNotRegistered' || newFailureCount >= MAX_FAILURE_COUNT) {
        await db.update(pushTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(pushTokens.id, tokenRecord.id));
        console.log(`Deactivated invalid push token: ${tokenRecord.token.substring(0, 20)}...`);
      } else {
        await db.update(pushTokens)
          .set({ failureCount: newFailureCount, updatedAt: new Date() })
          .where(eq(pushTokens.id, tokenRecord.id));
      }
    } else if (ticket.status === 'ok') {
      if (tokenRecord.failureCount > 0) {
        await db.update(pushTokens)
          .set({ failureCount: 0, lastUsedAt: new Date(), updatedAt: new Date() })
          .where(eq(pushTokens.id, tokenRecord.id));
      } else {
        await db.update(pushTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushTokens.id, tokenRecord.id));
      }
    }
  }
}

async function isDuplicateNotification(
  recipientId: string, 
  type: NotificationType, 
  dedupeKey?: string
): Promise<boolean> {
  if (!dedupeKey) return false;
  
  const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);
  
  const existing = await db.select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.recipientId, recipientId),
      eq(notifications.type, type),
      eq(notifications.dedupeKey, dedupeKey),
      gte(notifications.createdAt, windowStart)
    ))
    .limit(1);
  
  return existing.length > 0;
}

export async function createNotification(params: CreateNotificationParams): Promise<{ id: string } | null> {
  try {
    const dedupeKey = params.dedupeKey || 
      (params.entityType && params.entityId ? `${params.entityType}:${params.entityId}:${params.type}` : undefined);
    
    if (await isDuplicateNotification(params.recipientId, params.type, dedupeKey)) {
      console.log(`Skipping duplicate notification: ${params.type} for ${params.recipientId}`);
      return null;
    }
    
    const result = await db.insert(notifications).values({
      recipientId: params.recipientId,
      type: params.type,
      title: params.title,
      message: params.message,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata || {},
      dedupeKey,
    }).returning({ id: notifications.id });

    console.log('Notification created:', result[0]?.id);

    const tokenRecords = await db.select()
      .from(pushTokens)
      .where(and(
        eq(pushTokens.employeeId, params.recipientId),
        eq(pushTokens.isActive, true),
        lt(pushTokens.failureCount, MAX_FAILURE_COUNT)
      ));

    if (tokenRecords.length > 0) {
      const messages: PushMessage[] = tokenRecords.map(record => ({
        to: record.token,
        sound: 'default',
        title: params.title,
        body: params.message,
        data: {
          notificationId: result[0]?.id,
          type: params.type,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      }));

      const tickets = await sendExpoPushNotificationsBatch(messages);
      await handlePushTickets(tickets, tokenRecords.map(r => ({ 
        id: r.id, 
        token: r.token, 
        failureCount: r.failureCount 
      })));
    }

    return result[0] || null;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

export async function createBulkNotifications(
  recipientIds: string[],
  params: Omit<CreateNotificationParams, 'recipientId'>
): Promise<void> {
  const uniqueRecipients = [...new Set(recipientIds)];
  
  await Promise.all(
    uniqueRecipients.map(recipientId => 
      createNotification({ ...params, recipientId })
    )
  );
}

export async function getUnreadCountOptimized(employeeId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(
      eq(notifications.recipientId, employeeId),
      eq(notifications.isRead, false)
    ));
  
  return result[0]?.count || 0;
}

export async function cleanupOldNotifications(retentionDays: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  const deleted = await db.delete(notifications)
    .where(and(
      eq(notifications.isRead, true),
      lt(notifications.createdAt, cutoffDate)
    ))
    .returning({ id: notifications.id });
  
  console.log(`Cleaned up ${deleted.length} old notifications`);
  return deleted.length;
}

export async function cleanupInactivePushTokens(inactiveDays: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
  
  const deleted = await db.delete(pushTokens)
    .where(and(
      eq(pushTokens.isActive, false),
      lt(pushTokens.updatedAt, cutoffDate)
    ))
    .returning({ id: pushTokens.id });
  
  console.log(`Cleaned up ${deleted.length} inactive push tokens`);
  return deleted.length;
}

export async function notifyEventAssignment(
  employeeId: string,
  eventName: string,
  eventId: string,
  assignedByName: string
): Promise<void> {
  await createNotification({
    recipientId: employeeId,
    type: 'EVENT_ASSIGNED',
    title: 'New Event Assignment',
    message: `You have been assigned to "${eventName}" by ${assignedByName}`,
    entityType: 'EVENT',
    entityId: eventId,
    metadata: { eventName, assignedByName },
  });
}

export async function notifyIssueRaised(
  escalatedToId: string,
  issueId: string,
  issueType: string,
  eventName: string,
  raisedByName: string
): Promise<void> {
  await createNotification({
    recipientId: escalatedToId,
    type: 'ISSUE_RAISED',
    title: 'New Issue Raised',
    message: `${raisedByName} raised a ${issueType} issue for "${eventName}"`,
    entityType: 'ISSUE',
    entityId: issueId,
    metadata: { issueType, eventName, raisedByName },
  });
}

export async function notifyIssueResolved(
  raisedById: string,
  issueId: string,
  issueType: string,
  resolvedByName: string
): Promise<void> {
  await createNotification({
    recipientId: raisedById,
    type: 'ISSUE_RESOLVED',
    title: 'Issue Resolved',
    message: `Your ${issueType} issue has been resolved by ${resolvedByName}`,
    entityType: 'ISSUE',
    entityId: issueId,
    metadata: { issueType, resolvedByName },
  });
}

export async function notifyIssueStatusChanged(
  recipientId: string,
  issueId: string,
  newStatus: string,
  changedByName: string
): Promise<void> {
  await createNotification({
    recipientId: recipientId,
    type: 'ISSUE_STATUS_CHANGED',
    title: 'Issue Status Updated',
    message: `Issue status changed to ${newStatus} by ${changedByName}`,
    entityType: 'ISSUE',
    entityId: issueId,
    metadata: { newStatus, changedByName },
  });
}

export async function notifySubtaskAssigned(
  assigneeId: string,
  subtaskId: string,
  subtaskTitle: string,
  eventName: string,
  assignedByName: string,
  dueDate?: string
): Promise<void> {
  let message = `You have been assigned task "${subtaskTitle}" for "${eventName}" by ${assignedByName}`;
  if (dueDate) {
    message += `. Due: ${new Date(dueDate).toLocaleDateString()}`;
  }

  await createNotification({
    recipientId: assigneeId,
    type: 'SUBTASK_ASSIGNED',
    title: 'New Task Assigned',
    message,
    entityType: 'SUBTASK',
    entityId: subtaskId,
    metadata: { subtaskTitle, eventName, assignedByName, dueDate },
  });
}

export async function notifySubtaskDueSoon(
  assigneeId: string,
  subtaskId: string,
  subtaskTitle: string,
  eventName: string,
  dueDate: string
): Promise<void> {
  const dueDateFormatted = new Date(dueDate).toLocaleDateString();
  await createNotification({
    recipientId: assigneeId,
    type: 'SUBTASK_DUE_SOON',
    title: 'Task Due Soon',
    message: `Task "${subtaskTitle}" for "${eventName}" is due on ${dueDateFormatted}`,
    entityType: 'SUBTASK',
    entityId: subtaskId,
    metadata: { subtaskTitle, eventName, dueDate },
  });
}

export async function notifySubtaskOverdue(
  assigneeId: string,
  subtaskId: string,
  subtaskTitle: string,
  eventName: string
): Promise<void> {
  await createNotification({
    recipientId: assigneeId,
    type: 'SUBTASK_OVERDUE',
    title: 'Task Overdue',
    message: `Task "${subtaskTitle}" for "${eventName}" is overdue!`,
    entityType: 'SUBTASK',
    entityId: subtaskId,
    metadata: { subtaskTitle, eventName },
  });
}

export async function notifySubtaskCompleted(
  creatorId: string,
  subtaskId: string,
  subtaskTitle: string,
  completedByName: string
): Promise<void> {
  await createNotification({
    recipientId: creatorId,
    type: 'SUBTASK_COMPLETED',
    title: 'Task Completed',
    message: `Task "${subtaskTitle}" has been completed by ${completedByName}`,
    entityType: 'SUBTASK',
    entityId: subtaskId,
    metadata: { subtaskTitle, completedByName },
  });
}
