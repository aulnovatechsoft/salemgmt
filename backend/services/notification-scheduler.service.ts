import { db } from '../db';
import { events, eventAssignments, employees, pushNotificationQueue, pushTokens } from '../db/schema';
import { eq, and, gte, lte, sql, ne, inArray, lt } from 'drizzle-orm';
import { 
  notifySlaWarning, 
  notifySlaBreached,
  notifyManagerSlaBreached,
  notifyDeadlineWarning,
  notifyTaskEndingToday,
  cleanupOldNotifications,
  cleanupInactivePushTokens
} from './notification.service';

const SLA_WARNING_THRESHOLD_MINUTES = 60;
const DEADLINE_WARNING_DAYS = 1;
const MAX_PUSH_BATCH_SIZE = 100;
const RETRY_QUEUE_BATCH_SIZE = 50;

interface PushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function calculateNextRetryTime(attempts: number): Date {
  const baseDelay = 1000;
  const maxDelay = 3600000;
  const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
  return new Date(Date.now() + delay);
}

interface MaintenanceCategory {
  key: string;
  label: string;
  targetField: string;
  completedField: string;
  estHoursField: string;
  startedAtField: string;
}

const MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  { key: 'eb', label: 'EB', targetField: 'ebTarget', completedField: 'ebCompleted', estHoursField: 'ebEstHours', startedAtField: 'ebStartedAt' },
  { key: 'lease', label: 'Lease Circuit', targetField: 'leaseTarget', completedField: 'leaseCompleted', estHoursField: 'leaseEstHours', startedAtField: 'leaseStartedAt' },
  { key: 'btsDown', label: 'BTS-Down', targetField: 'btsDownTarget', completedField: 'btsDownCompleted', estHoursField: 'btsDownEstHours', startedAtField: 'btsDownStartedAt' },
  { key: 'ftthDown', label: 'FTTH-Down', targetField: 'ftthDownTarget', completedField: 'ftthDownCompleted', estHoursField: 'ftthDownEstHours', startedAtField: 'ftthDownStartedAt' },
  { key: 'routeFail', label: 'Route-Fail', targetField: 'routeFailTarget', completedField: 'routeFailCompleted', estHoursField: 'routeFailEstHours', startedAtField: 'routeFailStartedAt' },
  { key: 'ofcFail', label: 'OFC-Fail', targetField: 'ofcFailTarget', completedField: 'ofcFailCompleted', estHoursField: 'ofcFailEstHours', startedAtField: 'ofcFailStartedAt' },
];

export async function checkSlaNotifications(): Promise<void> {
  console.log('[SLA Scheduler] Checking SLA status for maintenance tasks...');
  
  try {
    const now = new Date();
    
    const activeEvents = await db.select({
      id: events.id,
      name: events.name,
      category: events.category,
      assignedTo: events.assignedTo,
      createdBy: events.createdBy,
    }).from(events)
      .where(eq(events.status, 'active'));
    
    if (activeEvents.length === 0) {
      console.log('[SLA Scheduler] No active events found');
      return;
    }
    
    const eventIds = activeEvents.map(e => e.id);
    
    const assignments = await db.select().from(eventAssignments)
      .where(and(
        inArray(eventAssignments.eventId, eventIds),
        ne(eventAssignments.submissionStatus, 'approved')
      ));
    
    const allEmployeeIds = [...new Set([
      ...assignments.map(a => a.employeeId),
      ...activeEvents.filter(e => e.assignedTo).map(e => e.assignedTo as string),
    ])];
    
    const employeeNames = allEmployeeIds.length > 0 
      ? await db.select({ id: employees.id, name: employees.name })
          .from(employees)
          .where(inArray(employees.id, allEmployeeIds))
      : [];
    const employeeNameMap = new Map(employeeNames.map(e => [e.id, e.name]));
    
    let warningsSent = 0;
    let breachesSent = 0;
    
    for (const assignment of assignments) {
      const event = activeEvents.find(e => e.id === assignment.eventId);
      if (!event) continue;
      
      for (const cat of MAINTENANCE_CATEGORIES) {
        const target = (assignment as any)[cat.targetField] || 0;
        const completed = (assignment as any)[cat.completedField] || 0;
        const estHours = (assignment as any)[cat.estHoursField];
        const startedAt = (assignment as any)[cat.startedAtField];
        
        if (target === 0 || completed >= target) continue;
        if (!estHours || !startedAt) continue;
        
        const startTime = new Date(startedAt);
        const deadlineTime = new Date(startTime.getTime() + (estHours * 60 * 60 * 1000));
        const remainingMs = deadlineTime.getTime() - now.getTime();
        const remainingMinutes = Math.floor(remainingMs / 60000);
        
        if (remainingMs <= 0) {
          await notifySlaBreached(
            assignment.employeeId,
            event.id,
            event.name,
            cat.label
          );
          breachesSent++;
          
          const teamMemberName = employeeNameMap.get(assignment.employeeId) || 'Team member';
          const managerId = event.assignedTo || event.createdBy;
          if (managerId && managerId !== assignment.employeeId) {
            await notifyManagerSlaBreached(
              managerId,
              event.id,
              event.name,
              cat.label,
              teamMemberName
            );
            breachesSent++;
          }
        } else if (remainingMinutes <= SLA_WARNING_THRESHOLD_MINUTES) {
          await notifySlaWarning(
            assignment.employeeId,
            event.id,
            event.name,
            cat.label,
            remainingMinutes
          );
          warningsSent++;
        }
      }
    }
    
    console.log(`[SLA Scheduler] Sent ${warningsSent} warnings and ${breachesSent} breach notifications`);
  } catch (error) {
    console.error('[SLA Scheduler] Error checking SLA notifications:', error);
  }
}

export async function checkDeadlineNotifications(): Promise<void> {
  console.log('[Deadline Scheduler] Checking task deadlines...');
  
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // End of tomorrow (1 day from now)
    const endOfWindow = new Date(today);
    endOfWindow.setDate(endOfWindow.getDate() + DEADLINE_WARNING_DAYS);
    endOfWindow.setHours(23, 59, 59, 999);
    
    const upcomingDeadlines = await db.select({
      id: events.id,
      name: events.name,
      endDate: events.endDate,
      targetSim: events.targetSim,
      targetFtth: events.targetFtth,
    }).from(events)
      .where(and(
        eq(events.status, 'active'),
        lte(events.endDate, endOfWindow),
        gte(events.endDate, today)
      ));
    
    if (upcomingDeadlines.length === 0) {
      console.log('[Deadline Scheduler] No upcoming deadlines found');
      return;
    }
    
    let notificationsSent = 0;
    
    for (const event of upcomingDeadlines) {
      const eventEndDate = new Date(event.endDate);
      eventEndDate.setHours(23, 59, 59, 999);
      
      const daysRemaining = Math.ceil((eventEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      const assignments = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, event.id),
          ne(eventAssignments.submissionStatus, 'approved'),
          ne(eventAssignments.submissionStatus, 'submitted')
        ));
      
      for (const assignment of assignments) {
        const simTarget = assignment.simTarget || 0;
        const ftthTarget = assignment.ftthTarget || 0;
        const simSold = assignment.simSold || 0;
        const ftthSold = assignment.ftthSold || 0;
        
        const totalTarget = simTarget + ftthTarget;
        const totalProgress = simSold + ftthSold;
        
        if (totalTarget > 0 && totalProgress < totalTarget) {
          if (daysRemaining === 0) {
            await notifyTaskEndingToday(
              assignment.employeeId,
              event.id,
              event.name
            );
          } else {
            await notifyDeadlineWarning(
              assignment.employeeId,
              event.id,
              event.name,
              daysRemaining,
              totalProgress,
              totalTarget
            );
          }
          notificationsSent++;
        }
      }
    }
    
    console.log(`[Deadline Scheduler] Sent ${notificationsSent} deadline notifications`);
  } catch (error) {
    console.error('[Deadline Scheduler] Error checking deadline notifications:', error);
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastCleanupDate: string | null = null;

export async function processRetryQueue(): Promise<void> {
  console.log('[Retry Queue] Processing failed push notifications...');
  
  try {
    const now = new Date();
    
    const pendingItems = await db.select()
      .from(pushNotificationQueue)
      .where(and(
        eq(pushNotificationQueue.status, 'pending'),
        lte(pushNotificationQueue.nextRetryAt, now)
      ))
      .limit(RETRY_QUEUE_BATCH_SIZE);
    
    if (pendingItems.length === 0) {
      console.log('[Retry Queue] No pending items to process');
      return;
    }
    
    console.log(`[Retry Queue] Found ${pendingItems.length} items to retry`);
    
    let successCount = 0;
    let failCount = 0;
    let permanentFailCount = 0;
    
    for (const item of pendingItems) {
      const payload = item.payload as unknown as PushMessage;
      
      await db.update(pushNotificationQueue)
        .set({ status: 'processing', updatedAt: now })
        .where(eq(pushNotificationQueue.id, item.id));
      
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([payload]),
        });
        
        if (!response.ok) {
          throw new Error(`Expo API error: ${response.status}`);
        }
        
        const result = await response.json();
        const ticket = result.data?.[0];
        
        if (ticket?.status === 'ok') {
          await db.update(pushNotificationQueue)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(pushNotificationQueue.id, item.id));
          
          await db.update(pushTokens)
            .set({ lastUsedAt: new Date(), failureCount: 0, updatedAt: new Date() })
            .where(eq(pushTokens.token, item.token));
          
          successCount++;
        } else {
          throw new Error(ticket?.message || 'Push notification failed');
        }
      } catch (error) {
        const newAttempts = item.attempts + 1;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (newAttempts >= item.maxAttempts) {
          await db.update(pushNotificationQueue)
            .set({ 
              status: 'failed', 
              attempts: newAttempts,
              lastAttemptAt: new Date(),
              errorMessage,
              updatedAt: new Date()
            })
            .where(eq(pushNotificationQueue.id, item.id));
          
          permanentFailCount++;
        } else {
          const nextRetry = calculateNextRetryTime(newAttempts);
          
          await db.update(pushNotificationQueue)
            .set({ 
              status: 'pending',
              attempts: newAttempts,
              lastAttemptAt: new Date(),
              nextRetryAt: nextRetry,
              errorMessage,
              updatedAt: new Date()
            })
            .where(eq(pushNotificationQueue.id, item.id));
          
          failCount++;
        }
      }
    }
    
    console.log(`[Retry Queue] Completed: ${successCount} success, ${failCount} retrying, ${permanentFailCount} permanent failures`);
  } catch (error) {
    console.error('[Retry Queue] Error processing queue:', error);
  }
}

async function runDailyCleanup(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  if (lastCleanupDate === today) {
    return;
  }
  
  console.log('[Cleanup Scheduler] Running daily cleanup...');
  lastCleanupDate = today;
  
  try {
    const notificationsDeleted = await cleanupOldNotifications(90);
    const tokensDeleted = await cleanupInactivePushTokens(30);
    console.log(`[Cleanup Scheduler] Completed: ${notificationsDeleted} notifications, ${tokensDeleted} tokens removed`);
  } catch (error) {
    console.error('[Cleanup Scheduler] Error during cleanup:', error);
  }
}

export function startNotificationScheduler(intervalMinutes: number = 15): void {
  if (schedulerInterval) {
    console.log('[Notification Scheduler] Already running');
    return;
  }
  
  console.log(`[Notification Scheduler] Starting with ${intervalMinutes} minute interval`);
  
  (async () => {
    try {
      await checkSlaNotifications();
    } catch (error) {
      console.error('[Notification Scheduler] Initial SLA check failed:', error);
    }
    
    try {
      await checkDeadlineNotifications();
    } catch (error) {
      console.error('[Notification Scheduler] Initial deadline check failed:', error);
    }
    
    try {
      await processRetryQueue();
    } catch (error) {
      console.error('[Notification Scheduler] Initial retry queue processing failed:', error);
    }
    
    try {
      await runDailyCleanup();
    } catch (error) {
      console.error('[Notification Scheduler] Initial cleanup failed:', error);
    }
  })();
  
  schedulerInterval = setInterval(async () => {
    const timestamp = new Date().toISOString();
    console.log(`[Notification Scheduler] Running scheduled checks at ${timestamp}...`);
    
    try {
      await checkSlaNotifications();
    } catch (error) {
      console.error('[Notification Scheduler] SLA check failed:', error);
    }
    
    try {
      await checkDeadlineNotifications();
    } catch (error) {
      console.error('[Notification Scheduler] Deadline check failed:', error);
    }
    
    try {
      await processRetryQueue();
    } catch (error) {
      console.error('[Notification Scheduler] Retry queue processing failed:', error);
    }
    
    try {
      await runDailyCleanup();
    } catch (error) {
      console.error('[Notification Scheduler] Cleanup failed:', error);
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopNotificationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Notification Scheduler] Stopped');
  }
}
