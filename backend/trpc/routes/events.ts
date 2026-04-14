import { z } from "zod";
import { eq, and, desc, gte, lte, sql, or, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, events, employees, auditLogs, eventAssignments, eventSalesEntries, eventSubtasks, employeeMaster, resources, resourceAllocations, financeCollectionEntries, notifications, maintenanceEntries } from "@/backend/db";
import { 
  notifyEventAssignment, 
  notifyTaskSubmitted, 
  notifyTaskApproved, 
  notifyTaskRejected,
  notifyIssueRaised,
  notifySubtaskAssigned,
  notifySubtaskCompleted,
  notifySubtaskReassigned
} from "@/backend/services/notification.service";

function getISTDate(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utc + istOffset);
}

function getISTDateString(): string {
  return getISTDate().toISOString().split('T')[0];
}

const subordinateCache = new Map<string, { ids: string[], timestamp: number }>();
const SUBORDINATE_CACHE_TTL = 5 * 60 * 1000;

async function getAllSubordinateIds(employeeId: string, maxDepth: number = 10): Promise<string[]> {
  const cached = subordinateCache.get(employeeId);
  if (cached && (Date.now() - cached.timestamp) < SUBORDINATE_CACHE_TTL) {
    return cached.ids;
  }

  const employee = await db.select({ persNo: employees.persNo }).from(employees)
    .where(eq(employees.id, employeeId));
  
  if (!employee[0]?.persNo) {
    return [];
  }
  
  const allSubordinateIds: string[] = [];
  let persNosToProcess: string[] = [employee[0].persNo];
  const processedPersNos = new Set<string>();
  let depth = 0;
  
  while (persNosToProcess.length > 0 && depth < maxDepth) {
    const currentBatch = persNosToProcess.filter(p => !processedPersNos.has(p));
    if (currentBatch.length === 0) break;
    
    for (const p of currentBatch) processedPersNos.add(p);
    
    const subordinates = await db.select({
      persNo: employeeMaster.persNo,
      linkedEmployeeId: employeeMaster.linkedEmployeeId,
    }).from(employeeMaster)
      .where(inArray(employeeMaster.reportingPersNo, currentBatch));
    
    persNosToProcess = [];
    for (const sub of subordinates) {
      if (sub.linkedEmployeeId) {
        allSubordinateIds.push(sub.linkedEmployeeId);
      }
      if (sub.persNo && !processedPersNos.has(sub.persNo)) {
        persNosToProcess.push(sub.persNo);
      }
    }
    depth++;
  }
  
  const result = [...new Set(allSubordinateIds)];
  subordinateCache.set(employeeId, { ids: result, timestamp: Date.now() });
  return result;
}

let cachedCircleGMs: Map<string, string> | null = null;
let cachedManagerHierarchy: Map<string, string[]> | null = null;
let hierarchyCacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAllCircleGMs(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedCircleGMs && (now - hierarchyCacheTime) < CACHE_TTL_MS) {
    return cachedCircleGMs;
  }
  
  const gmRecords = await db.select({
    circle: employeeMaster.circle,
    linkedEmployeeId: employeeMaster.linkedEmployeeId,
  }).from(employeeMaster)
    .where(eq(employeeMaster.designation, 'GM'));
  
  const gmMap = new Map<string, string>();
  for (const gm of gmRecords) {
    if (gm.circle && gm.linkedEmployeeId && !gmMap.has(gm.circle)) {
      gmMap.set(gm.circle, gm.linkedEmployeeId);
    }
  }
  
  cachedCircleGMs = gmMap;
  return gmMap;
}

async function buildManagerHierarchyMap(): Promise<Map<string, string[]>> {
  const now = Date.now();
  if (cachedManagerHierarchy && (now - hierarchyCacheTime) < CACHE_TTL_MS) {
    return cachedManagerHierarchy;
  }
  
  const allMasterRecords = await db.select({
    persNo: employeeMaster.persNo,
    reportingPersNo: employeeMaster.reportingPersNo,
    linkedEmployeeId: employeeMaster.linkedEmployeeId,
  }).from(employeeMaster);
  
  const persNoToLinkedId = new Map<string, string>();
  const persNoToReporting = new Map<string, string>();
  
  for (const record of allMasterRecords) {
    if (record.persNo && record.linkedEmployeeId) {
      persNoToLinkedId.set(record.persNo, record.linkedEmployeeId);
    }
    if (record.persNo && record.reportingPersNo) {
      persNoToReporting.set(record.persNo, record.reportingPersNo);
    }
  }
  
  const employeeToManagers = new Map<string, string[]>();
  
  for (const record of allMasterRecords) {
    if (!record.linkedEmployeeId) continue;
    
    const managers: string[] = [];
    let currentPersNo = record.persNo;
    const visited = new Set<string>();
    let depth = 0;
    const maxDepth = 10;
    
    while (currentPersNo && depth < maxDepth) {
      if (visited.has(currentPersNo)) break;
      visited.add(currentPersNo);
      
      const reportingPersNo = persNoToReporting.get(currentPersNo);
      if (!reportingPersNo) break;
      
      const managerId = persNoToLinkedId.get(reportingPersNo);
      if (managerId) {
        managers.push(managerId);
      }
      
      currentPersNo = reportingPersNo;
      depth++;
    }
    
    employeeToManagers.set(record.linkedEmployeeId, managers);
  }
  
  cachedManagerHierarchy = employeeToManagers;
  hierarchyCacheTime = now;
  return employeeToManagers;
}

let lastAutoCompleteRun = 0;
const AUTO_COMPLETE_INTERVAL = 60 * 1000;

async function autoCompleteExpiredEvents(eventsList: typeof events.$inferSelect[]) {
  const now = Date.now();
  if (now - lastAutoCompleteRun < AUTO_COMPLETE_INTERVAL) {
    const today = getISTDate();
    today.setHours(0, 0, 0, 0);
    return eventsList
      .filter(e => e.status === 'active' && e.endDate && new Date(e.endDate).setHours(23,59,59,999) < today.getTime())
      .map(e => e.id);
  }
  lastAutoCompleteRun = now;

  const today = getISTDate();
  today.setHours(0, 0, 0, 0);
  
  const expiredEventIds: string[] = [];
  for (const event of eventsList) {
    if (event.status === 'active' && event.endDate) {
      const endDate = new Date(event.endDate);
      endDate.setHours(23, 59, 59, 999);
      if (endDate < today) {
        expiredEventIds.push(event.id);
      }
    }
  }
  
  if (expiredEventIds.length > 0) {
    await Promise.all(expiredEventIds.map(id =>
      db.update(events)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(events.id, id))
    ));
    console.log(`Auto-completed ${expiredEventIds.length} expired works`);
  }
  
  return expiredEventIds;
}

export const eventsRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
      zone: z.string().optional(),
      category: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const results = await db.select().from(events).orderBy(desc(events.createdAt));
      
      // Get all event assignments to calculate sales progress
      const allAssignments = await db.select().from(eventAssignments);
      
      // Get actual sales from event_sales_entries (real submitted data)
      const allSalesEntrySums = await db.select({
        eventId: eventSalesEntries.eventId,
        totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        totalLeaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        totalEbSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
      }).from(eventSalesEntries).groupBy(eventSalesEntries.eventId);
      const salesEntryMap = new Map(allSalesEntrySums.map(s => [s.eventId, s]));
      
      // Get all employee master records for resolving team member names
      const allMasterRecords = await db.select({
        persNo: employeeMaster.persNo,
        name: employeeMaster.name,
        designation: employeeMaster.designation,
      }).from(employeeMaster);
      const masterMap = new Map(allMasterRecords.map(m => [m.persNo, m]));
      
      // Get creator and assignee details
      const allEmployeeIds = [...new Set([
        ...results.map(e => e.createdBy),
        ...results.map(e => e.assignedTo).filter(Boolean) as string[],
      ])];
      let employeeMap = new Map<string, { name: string; designation?: string }>();
      if (allEmployeeIds.length > 0) {
        const empRecords = await db.select({
          id: employees.id,
          name: employees.name,
          designation: employees.designation,
        }).from(employees).where(sql`${employees.id} IN ${allEmployeeIds}`);
        employeeMap = new Map(empRecords.map(e => [e.id, { name: e.name, designation: e.designation || undefined }]));
      }
      
      // Auto-complete expired events
      const expiredEventIds = await autoCompleteExpiredEvents(results);
      
      // Add sales progress and team member details to each event
      const eventsWithProgress = results.map(event => {
        const salesEntry = salesEntryMap.get(event.id);
        const simSold = Number(salesEntry?.totalSimsSold || 0);
        const ftthSold = Number(salesEntry?.totalFtthSold || 0);
        
        // Resolve team member names from persNos
        const assignedTeamPurseIds = (event.assignedTeam || []) as string[];
        const teamMembers = assignedTeamPurseIds.map(persNo => {
          const member = masterMap.get(persNo);
          return member ? { persNo, name: member.name, designation: member.designation } : { persNo, name: persNo, designation: null };
        });
        
        // Get creator and assignee info
        const creatorInfo = employeeMap.get(event.createdBy);
        const assigneeInfo = event.assignedTo ? employeeMap.get(event.assignedTo) : null;
        
        // Apply corrected status for expired events in this response
        const correctedStatus = expiredEventIds.includes(event.id) ? 'completed' : event.status;
        
        return {
          ...event,
          status: correctedStatus,
          simSold,
          ftthSold,
          teamMembers,
          creatorName: creatorInfo?.name || null,
          assigneeName: assigneeInfo?.name || null,
          assigneeDesignation: assigneeInfo?.designation || null,
        };
      });
      
      return eventsWithProgress;
    }),

  getMyEvents: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      circle: z.string().optional(),
      zone: z.string().optional(),
      category: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]) {
        return [];
      }
      
      // CMD and Admin users can see all tasks across all circles
      if (employee[0].role === 'ADMIN' || employee[0].role === 'CMD') {
        const allEvents = await db.select().from(events)
          .orderBy(desc(events.createdAt));
        
        const adminPersNo = employee[0].persNo;
        return allEvents.map(event => {
          const eventTeam = (event.assignedTeam || []) as string[];
          const isInTeam = adminPersNo && eventTeam.includes(adminPersNo);
          
          let ownershipCategory: 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task' = 'subordinate_task';
          if (event.status === 'draft' && event.createdBy === input.employeeId) {
            ownershipCategory = 'draft_task';
          } else if (event.createdBy === input.employeeId) {
            ownershipCategory = 'created_by_me';
          } else if (event.assignedTo === input.employeeId || isInTeam) {
            ownershipCategory = 'assigned_to_me';
          } else {
            ownershipCategory = 'subordinate_task';
          }
          return { ...event, ownershipCategory, simSold: 0, ftthSold: 0, submissionStatus: 'not_started', teamMembers: [], creatorName: null, assigneeName: null, assigneeDesignation: null, myAssignment: null };
        });
      }
      
      // Get the employee's persNo for team assignment check
      const employeePersNo = employee[0].persNo;
      
      const subordinateIds = await getAllSubordinateIds(input.employeeId);
      console.log(`Found ${subordinateIds.length} subordinates for employee ${input.employeeId}`);
      
      // Get subordinates' persNos for team assignment visibility
      let subordinatePersNos: string[] = [];
      if (subordinateIds.length > 0) {
        const subEmployees = await db.select({ persNo: employees.persNo })
          .from(employees)
          .where(inArray(employees.id, subordinateIds));
        subordinatePersNos = subEmployees.map(e => e.persNo).filter(Boolean) as string[];
      }
      
      const allVisibleIds = [input.employeeId, ...subordinateIds];
      const allVisiblePersNos = [employeePersNo, ...subordinatePersNos].filter(Boolean) as string[];
      
      // Query non-draft events: visible if created by user, assigned to user/subordinates, or user/subordinates are in assignedTeam
      // Build the team check condition - using EXISTS with jsonb_array_elements_text to avoid ? operator issue
      const teamCheckCondition = allVisiblePersNos.length > 0
        ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem IN (${sql.raw(allVisiblePersNos.map(p => `'${p}'`).join(','))}))`
        : sql`false`;
      
      const nonDraftResults = await db.select().from(events)
        .where(and(
          sql`${events.status} != 'draft'`,
          or(
            eq(events.createdBy, input.employeeId),
            inArray(events.assignedTo, allVisibleIds),
            teamCheckCondition
          )
        ))
        .orderBy(desc(events.createdAt));
      
      const employeeCircle = employee[0].circle;
      const [allDraftEvents, circleGMMap, managerHierarchyMap] = await Promise.all([
        db.select().from(events)
          .where(and(
            eq(events.status, 'draft'),
            or(
              eq(events.createdBy, input.employeeId),
              employeeCircle ? eq(events.circle, employeeCircle) : sql`false`
            )
          ))
          .orderBy(desc(events.createdAt)),
        getAllCircleGMs(),
        buildManagerHierarchyMap(),
      ]);
      
      const visibleDraftEvents: typeof allDraftEvents = [];
      
      for (const draftEvent of allDraftEvents) {
        if (draftEvent.createdBy === input.employeeId) {
          visibleDraftEvents.push(draftEvent);
          continue;
        }
        
        const circleGMId = circleGMMap.get(draftEvent.circle);
        
        if (circleGMId === input.employeeId) {
          visibleDraftEvents.push(draftEvent);
          continue;
        }
        
        if (circleGMId) {
          const managersAboveGM = managerHierarchyMap.get(circleGMId) || [];
          if (managersAboveGM.includes(input.employeeId)) {
            visibleDraftEvents.push(draftEvent);
            continue;
          }
        }
      }
      
      const seenIds = new Set<string>();
      const results: typeof nonDraftResults = [];
      
      for (const event of [...nonDraftResults, ...visibleDraftEvents]) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          results.push(event);
        }
      }
      
      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      console.log(`Found ${results.length} events for employee ${input.employeeId} (${visibleDraftEvents.length} drafts)`);
      
      if (results.length === 0) {
        return [];
      }
      
      const eventIds = results.map(e => e.id);
      const relevantAssignments = await db.select().from(eventAssignments)
        .where(inArray(eventAssignments.eventId, eventIds));
      
      // Get actual sales from event_sales_entries (real submitted data)
      const salesEntrySums = await db.select({
        eventId: eventSalesEntries.eventId,
        totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        totalLeaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        totalEbSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
      }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, eventIds)).groupBy(eventSalesEntries.eventId);
      const salesEntryMap2 = new Map(salesEntrySums.map(s => [s.eventId, s]));
      
      const allTeamPersNos = results.flatMap(e => (e.assignedTeam || []) as string[]);
      const uniquePersNos = [...new Set(allTeamPersNos)];
      let masterMap = new Map<string, { persNo: string; name: string; designation: string | null }>();
      if (uniquePersNos.length > 0) {
        const masterRecords = await db.select({
          persNo: employeeMaster.persNo,
          name: employeeMaster.name,
          designation: employeeMaster.designation,
        }).from(employeeMaster).where(inArray(employeeMaster.persNo, uniquePersNos));
        masterMap = new Map(masterRecords.map(m => [m.persNo, m]));
      }
      
      const allEmployeeIds = [...new Set([
        ...results.map(e => e.createdBy),
        ...results.map(e => e.assignedTo).filter(Boolean) as string[],
      ])];
      let employeeMap = new Map<string, { name: string; designation?: string }>();
      if (allEmployeeIds.length > 0) {
        const empRecords = await db.select({
          id: employees.id,
          name: employees.name,
          designation: employees.designation,
        }).from(employees).where(inArray(employees.id, allEmployeeIds));
        employeeMap = new Map(empRecords.map(e => [e.id, { name: e.name, designation: e.designation || undefined }]));
      }
      
      const expiredEventIds = await autoCompleteExpiredEvents(results);
      
      const eventsWithProgress = results.map(event => {
        const eventAssigns = relevantAssignments.filter(a => a.eventId === event.id);
        const salesEntry2 = salesEntryMap2.get(event.id);
        const simSold = Number(salesEntry2?.totalSimsSold || 0);
        const ftthSold = Number(salesEntry2?.totalFtthSold || 0);
        
        // Determine ownership category for this event
        let ownershipCategory: 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task' = 'subordinate_task';
        const eventTeam = (event.assignedTeam || []) as string[];
        const isInTeam = employeePersNo && eventTeam.includes(employeePersNo);
        
        if (event.status === 'draft' && event.createdBy === input.employeeId) {
          ownershipCategory = 'draft_task';
        } else if (event.createdBy === input.employeeId) {
          ownershipCategory = 'created_by_me';
        } else if (event.assignedTo === input.employeeId || isInTeam) {
          ownershipCategory = 'assigned_to_me';
        } else {
          ownershipCategory = 'subordinate_task';
        }
        
        // Find the current user's assignment for this event to get their submissionStatus
        const myAssignment = eventAssigns.find(a => a.employeeId === input.employeeId);
        
        // Determine the overall submission status:
        // 1. If user has their own assignment, use their status
        // 2. If user is the event creator/manager, aggregate the team's status
        let submissionStatus: string = 'not_started';
        if (myAssignment) {
          submissionStatus = myAssignment.submissionStatus || 'not_started';
        } else if (event.createdBy === input.employeeId || event.assignedTo === input.employeeId) {
          // For managers/creators: show the most advanced status of the team
          const statuses = eventAssigns.map(a => a.submissionStatus || 'not_started');
          if (statuses.includes('approved')) submissionStatus = 'approved';
          else if (statuses.includes('submitted')) submissionStatus = 'submitted';
          else if (statuses.includes('rejected')) submissionStatus = 'rejected';
          else if (statuses.includes('in_progress')) submissionStatus = 'in_progress';
        }
        
        const assignedTeamPurseIds = (event.assignedTeam || []) as string[];
        const teamMembers = assignedTeamPurseIds.map(persNo => {
          const member = masterMap.get(persNo);
          return member ? { persNo, name: member.name, designation: member.designation } : { persNo, name: persNo, designation: null };
        });
        
        const creatorInfo = employeeMap.get(event.createdBy);
        const assigneeInfo = event.assignedTo ? employeeMap.get(event.assignedTo) : null;
        
        const correctedStatus = expiredEventIds.includes(event.id) ? 'completed' : event.status;
        
        return {
          ...event,
          status: correctedStatus,
          simSold,
          ftthSold,
          submissionStatus,
          ownershipCategory,
          teamMembers,
          creatorName: creatorInfo?.name || null,
          assigneeName: assigneeInfo?.name || null,
          assigneeDesignation: assigneeInfo?.designation || null,
          myAssignment: myAssignment ? {
            simTarget: myAssignment.simTarget,
            ftthTarget: myAssignment.ftthTarget,
            simSold: myAssignment.simSold,
            ftthSold: myAssignment.ftthSold,
          } : null,
        };
      });
      
      console.log(`Returning ${eventsWithProgress.length} events for employee ${input.employeeId}`);
      return eventsWithProgress;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await db.select().from(events).where(eq(events.id, input.id));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      location: z.string().min(1),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      zone: z.string().min(1),
      startDate: z.string(),
      endDate: z.string(),
      taskCategory: z.enum(['S&M', 'O&M', 'Finance']).optional(),
      targetFinLc: z.number().min(0).optional(),
      targetFinLlFtth: z.number().min(0).optional(),
      targetFinTower: z.number().min(0).optional(),
      targetFinGsmPostpaid: z.number().min(0).optional(),
      targetFinRentBuilding: z.number().min(0).optional(),
      category: z.string().min(1),
      targetSim: z.number().min(0),
      targetFtth: z.number().min(0),
      targetEb: z.number().min(0).optional(),
      targetLease: z.number().min(0).optional(),
      targetBtsDown: z.number().min(0).optional(),
      targetFtthDown: z.number().min(0).optional(),
      targetRouteFail: z.number().min(0).optional(),
      targetOfcFail: z.number().min(0).optional(),
      ebEstHours: z.number().min(0).optional(),
      leaseEstHours: z.number().min(0).optional(),
      btsDownEstHours: z.number().min(0).optional(),
      ftthDownEstHours: z.number().min(0).optional(),
      routeFailEstHours: z.number().min(0).optional(),
      ofcFailEstHours: z.number().min(0).optional(),
      assignedTeam: z.array(z.string()).optional(),
      allocatedSim: z.number().min(0),
      allocatedFtth: z.number().min(0),
      keyInsight: z.string().optional(),
      assignedTo: z.string().uuid().optional(),
      assignedToStaffId: z.string().optional(),
      createdBy: z.string().uuid(),
      teamAssignments: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      
      // Server-side role validation: ADMIN cannot create events
      const creator = await db.select().from(employees).where(eq(employees.id, input.createdBy)).limit(1);
      if (creator[0]?.role === 'ADMIN' && creator[0]?.role !== 'CMD') {
        throw new Error('Admin users cannot create tasks. Please use a manager account.');
      }
      
      let assignedToId = input.assignedTo;
      
      if (input.assignedToStaffId && !assignedToId) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, input.assignedToStaffId));
        if (masterRecord[0]?.linkedEmployeeId) {
          assignedToId = masterRecord[0].linkedEmployeeId;
        }
      }
      
      const circleResources = await db.select().from(resources)
        .where(eq(resources.circle, input.circle));
      
      const simResource = circleResources.find(r => r.type === 'SIM');
      const ftthResource = circleResources.find(r => r.type === 'FTTH');
      
      if (input.allocatedSim > 0) {
        if (!simResource) {
          throw new Error(`No SIM inventory exists for circle ${input.circle}. Please set up circle resources first.`);
        }
        if (simResource.remaining < input.allocatedSim) {
          throw new Error(`Insufficient SIM resources. Available: ${simResource.remaining}, Requested: ${input.allocatedSim}`);
        }
      }
      
      if (input.allocatedFtth > 0) {
        if (!ftthResource) {
          throw new Error(`No FTTH inventory exists for circle ${input.circle}. Please set up circle resources first.`);
        }
        if (ftthResource.remaining < input.allocatedFtth) {
          throw new Error(`Insufficient FTTH resources. Available: ${ftthResource.remaining}, Requested: ${input.allocatedFtth}`);
        }
      }
      
      const result = await db.insert(events).values({
        name: input.name,
        location: input.location,
        circle: input.circle,
        zone: input.zone,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        taskCategory: input.taskCategory || 'S&M',
        category: input.category,
        targetSim: input.targetSim,
        targetFtth: input.targetFtth,
        targetEb: input.targetEb || 0,
        targetLease: input.targetLease || 0,
        targetBtsDown: input.targetBtsDown || 0,
        targetFtthDown: input.targetFtthDown || 0,
        targetRouteFail: input.targetRouteFail || 0,
        targetOfcFail: input.targetOfcFail || 0,
        targetFinLc: input.targetFinLc || 0,
        targetFinLlFtth: input.targetFinLlFtth || 0,
        targetFinTower: input.targetFinTower || 0,
        targetFinGsmPostpaid: input.targetFinGsmPostpaid || 0,
        targetFinRentBuilding: input.targetFinRentBuilding || 0,
        ebEstHours: input.ebEstHours || 0,
        leaseEstHours: input.leaseEstHours || 0,
        btsDownEstHours: input.btsDownEstHours || 0,
        ftthDownEstHours: input.ftthDownEstHours || 0,
        routeFailEstHours: input.routeFailEstHours || 0,
        ofcFailEstHours: input.ofcFailEstHours || 0,
        assignedTeam: input.assignedTeam || [],
        allocatedSim: input.allocatedSim,
        allocatedFtth: input.allocatedFtth,
        keyInsight: input.keyInsight,
        assignedTo: assignedToId,
        createdBy: input.createdBy,
      }).returning();
      
      if (input.allocatedSim > 0 && simResource) {
        await db.update(resources)
          .set({
            allocated: simResource.allocated + input.allocatedSim,
            remaining: simResource.remaining - input.allocatedSim,
            updatedAt: new Date(),
          })
          .where(eq(resources.id, simResource.id));
        
        await db.insert(resourceAllocations).values({
          resourceId: simResource.id,
          eventId: result[0].id,
          quantity: input.allocatedSim,
          allocatedBy: input.createdBy,
        });
      }
      
      if (input.allocatedFtth > 0 && ftthResource) {
        await db.update(resources)
          .set({
            allocated: ftthResource.allocated + input.allocatedFtth,
            remaining: ftthResource.remaining - input.allocatedFtth,
            updatedAt: new Date(),
          })
          .where(eq(resources.id, ftthResource.id));
        
        await db.insert(resourceAllocations).values({
          resourceId: ftthResource.id,
          eventId: result[0].id,
          quantity: input.allocatedFtth,
          allocatedBy: input.createdBy,
        });
      }
      
      if (assignedToId) {
        const existingAssignment = await db.select().from(eventAssignments)
          .where(and(
            eq(eventAssignments.eventId, result[0].id),
            eq(eventAssignments.employeeId, assignedToId)
          ));
        
        if (!existingAssignment[0]) {
          await db.insert(eventAssignments).values({
            eventId: result[0].id,
            employeeId: assignedToId,
            simTarget: 0,
            ftthTarget: 0,
            assignedBy: input.createdBy,
          });
          
          await db.update(events)
            .set({ assignedTeam: [assignedToId], updatedAt: new Date() })
            .where(eq(events.id, result[0].id));
        }
      }

      if (input.teamAssignments) {
        try {
          const assignments = JSON.parse(input.teamAssignments) as Array<{
            employeePurseId: string;
            employeeName: string;
            linkedEmployeeId: string | null;
            taskIds: string[];
          }>;
          
          
          for (const assignment of assignments) {
            const hasSim = assignment.taskIds.includes('SIM');
            const hasFtth = assignment.taskIds.includes('FTTH');
            const hasLease = assignment.taskIds.includes('LEASE_CIRCUIT');
            const hasEb = assignment.taskIds.includes('EB');
            
            let employeeId = assignment.linkedEmployeeId;
            
            if (!employeeId) {
              const masterRecord = await db.select().from(employeeMaster)
                .where(eq(employeeMaster.persNo, assignment.employeePurseId));
              employeeId = masterRecord[0]?.linkedEmployeeId || null;
            }
            
            if (employeeId) {
              const existingAssignment = await db.select().from(eventAssignments)
                .where(and(
                  eq(eventAssignments.eventId, result[0].id),
                  eq(eventAssignments.employeeId, employeeId)
                ));
              
              const simTarget = hasSim ? Math.ceil(input.targetSim / (assignments.filter(a => a.taskIds.includes('SIM')).length || 1)) : 0;
              const ftthTarget = hasFtth ? Math.ceil(input.targetFtth / (assignments.filter(a => a.taskIds.includes('FTTH')).length || 1)) : 0;
              const leaseTarget = hasLease ? Math.ceil((input.targetLease || 0) / (assignments.filter(a => a.taskIds.includes('LEASE_CIRCUIT')).length || 1)) : 0;
              const ebTarget = hasEb ? Math.ceil((input.targetEb || 0) / (assignments.filter(a => a.taskIds.includes('EB')).length || 1)) : 0;
              const assignedTaskTypes = assignment.taskIds;
              
              if (!existingAssignment[0]) {
                await db.insert(eventAssignments).values({
                  eventId: result[0].id,
                  employeeId: employeeId,
                  simTarget: simTarget,
                  ftthTarget: ftthTarget,
                  leaseTarget: leaseTarget,
                  ebTarget: ebTarget,
                  assignedTaskTypes: assignedTaskTypes,
                  assignedBy: input.createdBy,
                });
              } else {
                await db.update(eventAssignments)
                  .set({ simTarget, ftthTarget, leaseTarget, ebTarget, assignedTaskTypes, updatedAt: new Date() })
                  .where(eq(eventAssignments.id, existingAssignment[0].id));
              }
            }
          }
        } catch (e) {
          console.error("Error processing team assignments:", e);
        }
      }

      await db.insert(auditLogs).values({
        action: 'CREATE_EVENT',
        entityType: 'EVENT',
        entityId: result[0].id,
        performedBy: input.createdBy,
        details: { eventName: input.name },
      });

      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']).optional(),
      zone: z.string().min(1).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      category: z.string().optional(),
      targetSim: z.number().min(0).optional(),
      targetFtth: z.number().min(0).optional(),
      targetLease: z.number().min(0).optional(),
      targetBtsDown: z.number().min(0).optional(),
      targetRouteFail: z.number().min(0).optional(),
      targetFtthDown: z.number().min(0).optional(),
      targetOfcFail: z.number().min(0).optional(),
      targetEb: z.number().min(0).optional(),
      assignedTeam: z.array(z.string()).optional(),
      allocatedSim: z.number().min(0).optional(),
      allocatedFtth: z.number().min(0).optional(),
      keyInsight: z.string().optional(),
      status: z.string().optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      const { id, updatedBy, startDate, endDate, ...updateData } = input;
      
      const existingEvent = await db.select().from(events).where(eq(events.id, id));
      if (!existingEvent[0]) throw new Error("Event not found");
      
      if (input.allocatedSim !== undefined || input.allocatedFtth !== undefined) {
        const assignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, id));
        
        const totalSimDistributed = assignments.reduce((sum, a) => sum + a.simTarget, 0);
        const totalFtthDistributed = assignments.reduce((sum, a) => sum + a.ftthTarget, 0);
        
        if (input.allocatedSim !== undefined && input.allocatedSim < totalSimDistributed) {
          throw new Error(`Cannot reduce SIM allocation below distributed amount (${totalSimDistributed}). Reduce team targets first.`);
        }
        
        if (input.allocatedFtth !== undefined && input.allocatedFtth < totalFtthDistributed) {
          throw new Error(`Cannot reduce FTTH allocation below distributed amount (${totalFtthDistributed}). Reduce team targets first.`);
        }
        
        const circleResources = await db.select().from(resources)
          .where(eq(resources.circle, existingEvent[0].circle));
        
        if (input.allocatedSim !== undefined && input.allocatedSim > existingEvent[0].allocatedSim) {
          const simResource = circleResources.find(r => r.type === 'SIM');
          const additionalNeeded = input.allocatedSim - existingEvent[0].allocatedSim;
          if (!simResource || simResource.remaining < additionalNeeded) {
            throw new Error(`Insufficient SIM resources. Available: ${simResource?.remaining || 0}, Additional needed: ${additionalNeeded}`);
          }
          
          await db.update(resources)
            .set({
              allocated: simResource.allocated + additionalNeeded,
              remaining: simResource.remaining - additionalNeeded,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, simResource.id));
        } else if (input.allocatedSim !== undefined && input.allocatedSim < existingEvent[0].allocatedSim) {
          const simResource = circleResources.find(r => r.type === 'SIM');
          const returned = existingEvent[0].allocatedSim - input.allocatedSim;
          if (simResource) {
            await db.update(resources)
              .set({
                allocated: simResource.allocated - returned,
                remaining: simResource.remaining + returned,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, simResource.id));
          }
        }
        
        if (input.allocatedFtth !== undefined && input.allocatedFtth > existingEvent[0].allocatedFtth) {
          const ftthResource = circleResources.find(r => r.type === 'FTTH');
          const additionalNeeded = input.allocatedFtth - existingEvent[0].allocatedFtth;
          if (!ftthResource || ftthResource.remaining < additionalNeeded) {
            throw new Error(`Insufficient FTTH resources. Available: ${ftthResource?.remaining || 0}, Additional needed: ${additionalNeeded}`);
          }
          
          await db.update(resources)
            .set({
              allocated: ftthResource.allocated + additionalNeeded,
              remaining: ftthResource.remaining - additionalNeeded,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, ftthResource.id));
        } else if (input.allocatedFtth !== undefined && input.allocatedFtth < existingEvent[0].allocatedFtth) {
          const ftthResource = circleResources.find(r => r.type === 'FTTH');
          const returned = existingEvent[0].allocatedFtth - input.allocatedFtth;
          if (ftthResource) {
            await db.update(resources)
              .set({
                allocated: ftthResource.allocated - returned,
                remaining: ftthResource.remaining + returned,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, ftthResource.id));
          }
        }
      }
      
      const updateValues: Record<string, unknown> = { ...updateData, updatedAt: new Date() };
      if (startDate) updateValues.startDate = new Date(startDate);
      if (endDate) updateValues.endDate = new Date(endDate);
      
      const result = await db.update(events)
        .set(updateValues)
        .where(eq(events.id, id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_EVENT',
        entityType: 'EVENT',
        entityId: id,
        performedBy: updatedBy,
        details: updateData,
      });

      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ 
      id: z.string().uuid(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      await db.update(events)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(events.id, input.id));

      await db.insert(auditLogs).values({
        action: 'DELETE_EVENT',
        entityType: 'EVENT',
        entityId: input.id,
        performedBy: input.deletedBy,
        details: {},
      });

      return { success: true };
    }),

  getByCircle: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      const result = await db.select().from(events)
        .where(eq(events.circle, input.circle))
        .orderBy(desc(events.createdAt));
      
      // Auto-complete expired events
      const expiredIds = await autoCompleteExpiredEvents(result);
      
      return result.map(e => ({
        ...e,
        status: expiredIds.includes(e.id) ? 'completed' : e.status
      }));
    }),

  getActiveEvents: publicProcedure
    .query(async () => {
      
      // First auto-complete any expired events in the database
      const allActive = await db.select().from(events)
        .where(eq(events.status, 'active'));
      await autoCompleteExpiredEvents(allActive);
      
      // Now fetch truly active events
      const now = new Date();
      const result = await db.select().from(events)
        .where(and(
          lte(events.startDate, now),
          gte(events.endDate, now),
          eq(events.status, 'active')
        ))
        .orderBy(desc(events.startDate));
      return result;
    }),

  getUpcomingEvents: publicProcedure
    .query(async () => {
      
      // First auto-complete any expired events
      const allActive = await db.select().from(events)
        .where(eq(events.status, 'active'));
      await autoCompleteExpiredEvents(allActive);
      
      const now = new Date();
      const result = await db.select().from(events)
        .where(and(
          gte(events.startDate, now),
          eq(events.status, 'active')
        ))
        .orderBy(events.startDate);
      return result;
    }),

  assignTeam: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeIds: z.array(z.string().uuid()),
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      for (const employeeId of input.employeeIds) {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: employeeId,
          assignedBy: input.assignedBy,
        }).onConflictDoNothing();
      }

      await db.update(events)
        .set({ assignedTeam: input.employeeIds, updatedAt: new Date() })
        .where(eq(events.id, input.eventId));

      await db.insert(auditLogs).values({
        action: 'ASSIGN_TEAM',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.assignedBy,
        details: { employeeIds: input.employeeIds },
      });

      return { success: true };
    }),

  getEventWithDetails: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      
      if (!input.id || input.id.trim() === '') {
        console.error("getEventWithDetails: Empty ID provided");
        throw new Error("Event ID is required");
      }
      
      try {
        const eventResult = await db.select().from(events).where(eq(events.id, input.id));
        
        if (!eventResult[0]) {
          return null;
        }
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.id));
      
      const salesEntries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.id))
        .orderBy(desc(eventSalesEntries.createdAt));
      
      const financeEntries = await db.select().from(financeCollectionEntries)
        .where(eq(financeCollectionEntries.eventId, input.id))
        .orderBy(desc(financeCollectionEntries.createdAt));
      
      const omEntries = await db.select().from(maintenanceEntries)
        .where(eq(maintenanceEntries.eventId, input.id))
        .orderBy(desc(maintenanceEntries.createdAt));
      
      const subtasks = await db.select().from(eventSubtasks)
        .where(eq(eventSubtasks.eventId, input.id))
        .orderBy(desc(eventSubtasks.createdAt));
      
      const assignedEmployeeIds = assignments.map(a => a.employeeId);
      const subtaskAssigneeIds = subtasks.map(s => s.assignedTo).filter(Boolean) as string[];
      const allEmployeeIds = [...new Set([...assignedEmployeeIds, ...subtaskAssigneeIds])];
      
      let teamMembers: any[] = [];
      if (allEmployeeIds.length > 0) {
        teamMembers = await db.select().from(employees)
          .where(sql`${employees.id} IN ${allEmployeeIds}`);
      }
      
      const assignedTeamPurseIds = (eventResult[0].assignedTeam || []) as string[];
      
      let masterRecords: any[] = [];
      if (allEmployeeIds.length > 0 || assignedTeamPurseIds.length > 0) {
        masterRecords = await db.select().from(employeeMaster)
          .where(sql`${employeeMaster.linkedEmployeeId} IN ${allEmployeeIds.length > 0 ? allEmployeeIds : ['00000000-0000-0000-0000-000000000000']} OR ${employeeMaster.persNo} IN ${assignedTeamPurseIds.length > 0 ? assignedTeamPurseIds : ['__none__']}`);
      }
      
      const persNoMap = new Map<string, string>();
      const masterByPurseId = new Map<string, typeof masterRecords[0]>();
      masterRecords.forEach((m: any) => {
        if (m.linkedEmployeeId) {
          persNoMap.set(m.linkedEmployeeId, m.persNo);
        }
        masterByPurseId.set(m.persNo, m);
      });
      
      const teamWithAllocations = assignments.map(assignment => {
        const employee = teamMembers.find(e => e.id === assignment.employeeId);
        const memberSales = salesEntries.filter(s => s.employeeId === assignment.employeeId);
        const memberMaintenance = omEntries.filter(m => m.employeeId === assignment.employeeId);
        const salesEntrySimsSold = memberSales.reduce((sum, s) => sum + s.simsSold, 0);
        const salesEntryFtthSold = memberSales.reduce((sum, s) => sum + s.ftthSold, 0);
        
        const totalSimsSold = salesEntrySimsSold;
        const totalFtthSold = salesEntryFtthSold;
        const totalLeaseCompleted = assignment.leaseCompleted || 0;
        const totalEbCompleted = assignment.ebCompleted || 0;
        
        let employeeData = employee ? { ...employee, persNo: persNoMap.get(employee.id) || null } : undefined;
        
        if (!employeeData) {
          const persNo = persNoMap.get(assignment.employeeId);
          const master = persNo ? masterByPurseId.get(persNo) : null;
          if (master) {
            employeeData = {
              id: assignment.employeeId,
              name: master.name,
              designation: master.designation,
              persNo: master.persNo,
              role: 'SALES_STAFF',
            };
          }
        }
        
        return {
          ...assignment,
          employee: employeeData,
          actualSimSold: totalSimsSold,
          actualFtthSold: totalFtthSold,
          actualLeaseCompleted: totalLeaseCompleted,
          actualEbCompleted: totalEbCompleted,
          salesEntries: memberSales,
          maintenanceEntries: memberMaintenance,
        };
      });
      
      for (const persNo of assignedTeamPurseIds) {
        const alreadyIncluded = teamWithAllocations.some(t => t.employee?.persNo === persNo);
        if (!alreadyIncluded) {
          const master = masterByPurseId.get(persNo);
          if (master) {
            // Use persNo as employeeId for unlinked employees - frontend will handle this
            const employeeIdToUse = master.linkedEmployeeId || persNo;
            teamWithAllocations.push({
              id: `temp-${persNo}`,
              eventId: input.id,
              employeeId: employeeIdToUse,
              simTarget: 0,
              ftthTarget: 0,
              simSold: 0,
              ftthSold: 0,
              leaseTarget: 0,
              leaseCompleted: 0,
              ebTarget: 0,
              ebCompleted: 0,
              assignedTaskTypes: [],
              assignedBy: eventResult[0].createdBy,
              assignedAt: new Date(),
              updatedAt: new Date(),
              submissionStatus: 'not_started',
              submittedAt: null,
              reviewedAt: null,
              rejectionReason: null,
              employee: {
                id: employeeIdToUse,
                name: master.name,
                designation: master.designation,
                persNo: master.persNo,
                role: 'SALES_STAFF',
                isLinked: !!master.linkedEmployeeId,
              },
              actualSimSold: 0,
              actualFtthSold: 0,
              actualLeaseCompleted: 0,
              actualEbCompleted: 0,
              salesEntries: [],
              maintenanceEntries: [],
            } as any);
          }
        }
      }
      
      const subtasksWithAssignees = subtasks.map(subtask => {
        const emp = subtask.assignedTo ? teamMembers.find(e => e.id === subtask.assignedTo) : undefined;
        return {
          ...subtask,
          assignedEmployee: emp ? { ...emp, persNo: persNoMap.get(emp.id) || null } : undefined,
        };
      });
      
      const totalSimsSold = salesEntries.reduce((sum, s) => sum + s.simsSold, 0);
      const totalFtthSold = salesEntries.reduce((sum, s) => sum + s.ftthSold, 0);
      const totalLeaseCompleted = salesEntries.reduce((sum, s) => sum + (s.leaseSold || 0), 0);
      const totalEbCompleted = salesEntries.reduce((sum, s) => sum + (s.ebSold || 0), 0);
      
      const totalBtsDownCompleted = assignments.reduce((sum, a) => sum + (a.btsDownCompleted || 0), 0);
      const totalFtthDownCompleted = assignments.reduce((sum, a) => sum + (a.ftthDownCompleted || 0), 0);
      const totalRouteFailCompleted = assignments.reduce((sum, a) => sum + (a.routeFailCompleted || 0), 0);
      const totalOfcFailCompleted = assignments.reduce((sum, a) => sum + (a.ofcFailCompleted || 0), 0);

      const subtaskStats = {
        total: subtasks.length,
        completed: subtasks.filter(s => s.status === 'completed').length,
        pending: subtasks.filter(s => s.status === 'pending').length,
        inProgress: subtasks.filter(s => s.status === 'in_progress').length,
      };
      
      let assignedToEmployee: any = undefined;
      if (eventResult[0].assignedTo) {
        const assignee = await db.select().from(employees)
          .where(eq(employees.id, eventResult[0].assignedTo));
        if (assignee[0]) {
          const managerPurseId = persNoMap.get(assignee[0].id) || null;
          assignedToEmployee = { ...assignee[0], persNo: managerPurseId };
        }
      }
      
      const calculateSlaStatus = (
        startedAt: Date | null,
        estHours: number,
        completed: number,
        target: number
      ) => {
        if (!estHours || estHours === 0) {
          return { status: 'no_sla', message: 'No SLA set', remainingMs: 0, elapsedMs: 0 };
        }
        
        if (target > 0 && completed >= target) {
          return { status: 'completed', message: 'Completed', remainingMs: 0, elapsedMs: 0 };
        }
        
        if (!startedAt) {
          return { status: 'not_started', message: `SLA: ${estHours}h`, remainingMs: estHours * 60 * 60 * 1000, elapsedMs: 0 };
        }
        
        const now = new Date();
        const startTime = new Date(startedAt).getTime();
        const deadlineMs = startTime + (estHours * 60 * 60 * 1000);
        const elapsedMs = now.getTime() - startTime;
        const remainingMs = deadlineMs - now.getTime();
        
        if (remainingMs <= 0) {
          const overdueMs = Math.abs(remainingMs);
          const overdueHours = Math.floor(overdueMs / (60 * 60 * 1000));
          const overdueMins = Math.floor((overdueMs % (60 * 60 * 1000)) / (60 * 1000));
          return { 
            status: 'breached', 
            message: `Overdue by ${overdueHours}h ${overdueMins}m`,
            remainingMs,
            elapsedMs,
          };
        }
        
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
        const remainingMins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        
        if (remainingMs <= 60 * 60 * 1000) {
          return { 
            status: 'warning', 
            message: `${remainingMins}m remaining`,
            remainingMs,
            elapsedMs,
          };
        }
        
        return { 
          status: 'in_progress', 
          message: `${remainingHours}h ${remainingMins}m remaining`,
          remainingMs,
          elapsedMs,
        };
      };
      
      const e = eventResult[0];
      const slaStatus = {
        eb: calculateSlaStatus(e.ebStartedAt, e.ebEstHours, e.ebCompleted, e.targetEb),
        lease: calculateSlaStatus(e.leaseStartedAt, e.leaseEstHours, e.leaseCompleted, e.targetLease),
        btsDown: calculateSlaStatus(e.btsDownStartedAt, e.btsDownEstHours, e.btsDownCompleted, e.targetBtsDown),
        ftthDown: calculateSlaStatus(e.ftthDownStartedAt, e.ftthDownEstHours, e.ftthDownCompleted, e.targetFtthDown),
        routeFail: calculateSlaStatus(e.routeFailStartedAt, e.routeFailEstHours, e.routeFailCompleted, e.targetRouteFail),
        ofcFail: calculateSlaStatus(e.ofcFailStartedAt, e.ofcFailEstHours, e.ofcFailCompleted, e.targetOfcFail),
      };
      
      const result = {
          ...eventResult[0],
          assignedToEmployee,
          teamWithAllocations,
          salesEntries,
          financeEntries,
          maintenanceEntries: omEntries,
          subtasks: subtasksWithAssignees,
          slaStatus,
          summary: {
            totalSimsSold,
            totalFtthSold,
            totalLeaseCompleted,
            totalEbCompleted,
            totalBtsDownCompleted,
            totalFtthDownCompleted,
            totalRouteFailCompleted,
            totalOfcFailCompleted,
            totalEntries: salesEntries.length,
            totalFinanceEntries: financeEntries.length,
            totalMaintenanceEntries: omEntries.length,
            teamCount: assignments.length,
            subtaskStats,
          },
        };
        
        return result;
      } catch (error) {
        console.error("Error fetching event details:", error);
        throw error;
      }
    }),

  getEventResourceStatus: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const totalSimDistributed = assignments.reduce((sum, a) => sum + a.simTarget, 0);
      const totalFtthDistributed = assignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      
      // Get actual sales from event_sales_entries (real submitted data)
      const resourceSalesEntries = await db.select({
        totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        totalLeaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        totalEbSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
      }).from(eventSalesEntries).where(eq(eventSalesEntries.eventId, input.eventId));
      const totalSimSold = Number(resourceSalesEntries[0]?.totalSimsSold || 0);
      const totalFtthSold = Number(resourceSalesEntries[0]?.totalFtthSold || 0);
      
      // Use targetSim/targetFtth as the max distributable (falls back to allocated if target is 0)
      const maxSim = event[0].targetSim || event[0].allocatedSim;
      const maxFtth = event[0].targetFtth || event[0].allocatedFtth;
      
      return {
        target: {
          sim: event[0].targetSim,
          ftth: event[0].targetFtth,
        },
        allocated: {
          sim: event[0].allocatedSim,
          ftth: event[0].allocatedFtth,
        },
        distributed: {
          sim: totalSimDistributed,
          ftth: totalFtthDistributed,
        },
        sold: {
          sim: totalSimSold,
          ftth: totalFtthSold,
        },
        remaining: {
          simToDistribute: maxSim - totalSimDistributed,
          ftthToDistribute: maxFtth - totalFtthDistributed,
          simUnsold: totalSimDistributed - totalSimSold,
          ftthUnsold: totalFtthDistributed - totalFtthSold,
        },
      };
    }),

  assignTeamMember: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      simTarget: z.number().min(0),
      ftthTarget: z.number().min(0),
      leaseTarget: z.number().min(0).optional(),
      ebTarget: z.number().min(0).optional(),
      assignedTaskTypes: z.array(z.string()).optional(),
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const leaseTarget = input.leaseTarget ?? 0;
      const ebTarget = input.ebTarget ?? 0;
      
      let assignedTaskTypes = input.assignedTaskTypes;
      if (!assignedTaskTypes) {
        assignedTaskTypes = [];
        if (input.simTarget > 0) assignedTaskTypes.push('SIM');
        if (input.ftthTarget > 0) assignedTaskTypes.push('FTTH');
        if (leaseTarget > 0) assignedTaskTypes.push('LEASE_CIRCUIT');
        if (ebTarget > 0) assignedTaskTypes.push('EB');
      }
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const existing = allAssignments.find(a => a.employeeId === input.employeeId);
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== input.employeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      const currentLeaseDistributed = otherAssignments.reduce((sum, a) => sum + a.leaseTarget, 0);
      const currentEbDistributed = otherAssignments.reduce((sum, a) => sum + a.ebTarget, 0);
      
      const newTotalSim = currentSimDistributed + input.simTarget;
      const newTotalFtth = currentFtthDistributed + input.ftthTarget;
      const newTotalLease = currentLeaseDistributed + leaseTarget;
      const newTotalEb = currentEbDistributed + ebTarget;
      
      if (newTotalSim > event[0].allocatedSim) {
        const available = event[0].allocatedSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
      }
      
      if (newTotalFtth > event[0].allocatedFtth) {
        const available = event[0].allocatedFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
      }
      
      const maxLease = event[0].targetLease || 0;
      if (maxLease > 0 && newTotalLease > maxLease) {
        const available = maxLease - currentLeaseDistributed;
        throw new Error(`Cannot assign ${leaseTarget} Lease Circuit. Only ${available} available for distribution.`);
      }
      
      const maxEb = event[0].targetEb || 0;
      if (maxEb > 0 && newTotalEb > maxEb) {
        const available = maxEb - currentEbDistributed;
        throw new Error(`Cannot assign ${ebTarget} EB. Only ${available} available for distribution.`);
      }
      
      if (existing) {
        await db.update(eventAssignments)
          .set({
            simTarget: input.simTarget,
            ftthTarget: input.ftthTarget,
            leaseTarget: leaseTarget,
            ebTarget: ebTarget,
            assignedTaskTypes: assignedTaskTypes,
            updatedAt: new Date(),
          })
          .where(eq(eventAssignments.id, existing.id));
      } else {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: input.employeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          leaseTarget: leaseTarget,
          ebTarget: ebTarget,
          assignedTaskTypes: assignedTaskTypes,
          assignedBy: input.assignedBy,
        });
        
        const currentTeam = (event[0].assignedTeam || []) as string[];
        if (!currentTeam.includes(input.employeeId)) {
          await db.update(events)
            .set({ assignedTeam: [...currentTeam, input.employeeId], updatedAt: new Date() })
            .where(eq(events.id, input.eventId));
        }
      }

      await db.insert(auditLogs).values({
        action: 'ASSIGN_TEAM_MEMBER',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.assignedBy,
        details: { employeeId: input.employeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget, leaseTarget, ebTarget, assignedTaskTypes },
      });

      // Send notification to assigned team member (only for new assignments)
      if (!existing) {
        try {
          const assigner = await db.select().from(employees)
            .where(eq(employees.id, input.assignedBy));
          
          if (assigner[0]) {
            await notifyEventAssignment(
              input.employeeId,
              event[0].name,
              input.eventId,
              assigner[0].name
            );
          }
        } catch (notifError) {
          console.error("Failed to send assignment notification:", notifError);
        }
      }

      return { success: true };
    }),

  removeTeamMember: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      removedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (assignment[0] && (assignment[0].simSold > 0 || assignment[0].ftthSold > 0)) {
        throw new Error(`Cannot remove team member with recorded sales. SIM sold: ${assignment[0].simSold}, FTTH sold: ${assignment[0].ftthSold}. Please reassign sales first.`);
      }
      
      await db.delete(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (event[0]) {
        const currentTeam = (event[0].assignedTeam || []) as string[];
        const updatedTeam = currentTeam.filter(id => id !== input.employeeId);
        await db.update(events)
          .set({ assignedTeam: updatedTeam, updatedAt: new Date() })
          .where(eq(events.id, input.eventId));
      }

      await db.insert(auditLogs).values({
        action: 'REMOVE_TEAM_MEMBER',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.removedBy,
        details: { employeeId: input.employeeId },
      });

      return { success: true };
    }),

  submitEventSales: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      simsSold: z.number().min(0),
      simsActivated: z.number().min(0),
      ftthSold: z.number().min(0),
      ftthActivated: z.number().min(0),
      leaseSold: z.number().min(0).optional().default(0),
      ebSold: z.number().min(0).optional().default(0),
      customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']),
      photos: z.array(z.object({
        uri: z.string(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        timestamp: z.string(),
      })).optional(),
      gpsLatitude: z.string().optional(),
      gpsLongitude: z.string().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      if (event[0].status === 'completed' || event[0].status === 'cancelled') {
        throw new Error(`Cannot submit sales for ${event[0].status} event`);
      }
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (!assignment[0]) {
        throw new Error("You are not assigned to this event. Please contact the event manager.");
      }

      const assignedTypes = (assignment[0].assignedTaskTypes as string[]) || [];
      const hasAssignedTypes = assignedTypes.length > 0;
      if (hasAssignedTypes) {
        if (input.simsSold > 0 && !assignedTypes.includes('SIM')) {
          throw new Error('You are not assigned to SIM tasks');
        }
        if (input.ftthSold > 0 && !assignedTypes.includes('FTTH')) {
          throw new Error('You are not assigned to FTTH tasks');
        }
        if (input.leaseSold > 0 && !assignedTypes.includes('LEASE_CIRCUIT')) {
          throw new Error('You are not assigned to Lease Circuit tasks');
        }
        if (input.ebSold > 0 && !assignedTypes.includes('EB')) {
          throw new Error('You are not assigned to EB tasks');
        }
      }
      
      const newTotalSim = assignment[0].simSold + input.simsSold;
      const newTotalFtth = assignment[0].ftthSold + input.ftthSold;
      const newTotalLease = (assignment[0].leaseCompleted || 0) + input.leaseSold;
      const newTotalEb = (assignment[0].ebCompleted || 0) + input.ebSold;
      
      if (newTotalSim > assignment[0].simTarget) {
        const remaining = assignment[0].simTarget - assignment[0].simSold;
        throw new Error(`Cannot sell ${input.simsSold} SIMs. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      if (newTotalFtth > assignment[0].ftthTarget) {
        const remaining = assignment[0].ftthTarget - assignment[0].ftthSold;
        throw new Error(`Cannot sell ${input.ftthSold} FTTH. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }

      if (input.leaseSold > 0 && newTotalLease > (assignment[0].leaseTarget || 0)) {
        const remaining = (assignment[0].leaseTarget || 0) - (assignment[0].leaseCompleted || 0);
        throw new Error(`Cannot sell ${input.leaseSold} Lease Circuit. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }

      if (input.ebSold > 0 && newTotalEb > (assignment[0].ebTarget || 0)) {
        const remaining = (assignment[0].ebTarget || 0) - (assignment[0].ebCompleted || 0);
        throw new Error(`Cannot sell ${input.ebSold} EB. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      const result = await db.insert(eventSalesEntries).values({
        eventId: input.eventId,
        employeeId: input.employeeId,
        simsSold: input.simsSold,
        simsActivated: input.simsActivated,
        ftthSold: input.ftthSold,
        ftthActivated: input.ftthActivated,
        leaseSold: input.leaseSold,
        ebSold: input.ebSold,
        customerType: input.customerType,
        photos: input.photos || [],
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        remarks: input.remarks,
      }).returning();

      const assignmentUpdate: any = {
        simSold: newTotalSim,
        ftthSold: newTotalFtth,
        updatedAt: new Date(),
      };
      if (input.leaseSold > 0) {
        assignmentUpdate.leaseCompleted = newTotalLease;
      }
      if (input.ebSold > 0) {
        assignmentUpdate.ebCompleted = newTotalEb;
      }
      
      await db.update(eventAssignments)
        .set(assignmentUpdate)
        .where(eq(eventAssignments.id, assignment[0].id));

      if (input.leaseSold > 0 || input.ebSold > 0) {
        const allAssignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        const eventUpdate: any = { updatedAt: new Date() };
        if (input.leaseSold > 0) {
          eventUpdate.leaseCompleted = allAssignments.reduce((sum, a) => sum + (a.leaseCompleted || 0), 0);
          if (!event[0].leaseStartedAt && eventUpdate.leaseCompleted > 0) {
            eventUpdate.leaseStartedAt = new Date();
          }
        }
        if (input.ebSold > 0) {
          eventUpdate.ebCompleted = allAssignments.reduce((sum, a) => sum + (a.ebCompleted || 0), 0);
          if (!event[0].ebStartedAt && eventUpdate.ebCompleted > 0) {
            eventUpdate.ebStartedAt = new Date();
          }
        }
        await db.update(events)
          .set(eventUpdate)
          .where(eq(events.id, input.eventId));
      }
      
      if (input.simsSold > 0) {
        const simResource = await db.select().from(resources)
          .where(and(
            eq(resources.circle, event[0].circle),
            eq(resources.type, 'SIM')
          ));
        if (simResource[0]) {
          await db.update(resources)
            .set({
              used: simResource[0].used + input.simsSold,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, simResource[0].id));
        }
      }
      
      if (input.ftthSold > 0) {
        const ftthResource = await db.select().from(resources)
          .where(and(
            eq(resources.circle, event[0].circle),
            eq(resources.type, 'FTTH')
          ));
        if (ftthResource[0]) {
          await db.update(resources)
            .set({
              used: ftthResource[0].used + input.ftthSold,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, ftthResource[0].id));
        }
      }

      await db.insert(auditLogs).values({
        action: 'SUBMIT_EVENT_SALES',
        entityType: 'SALES',
        entityId: result[0].id,
        performedBy: input.employeeId,
        details: { eventId: input.eventId, simsSold: input.simsSold, ftthSold: input.ftthSold, leaseSold: input.leaseSold, ebSold: input.ebSold },
      });

      await db.insert(auditLogs).values({
        action: 'SUBMIT_EVENT_SALES',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.employeeId,
        timestamp: new Date(),
        details: {
          simsSold: input.simsSold,
          simsActivated: input.simsActivated,
          ftthSold: input.ftthSold,
          ftthActivated: input.ftthActivated,
          leaseSold: input.leaseSold,
          ebSold: input.ebSold,
          customerType: input.customerType,
        },
      });

      return result[0];
    }),

  getEventSalesEntries: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const entries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.eventId))
        .orderBy(desc(eventSalesEntries.createdAt));
      return entries;
    }),

  submitFinanceCollection: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      financeType: z.string(),
      amountCollected: z.number().min(1),
      paymentMode: z.string(),
      transactionReference: z.string().optional(),
      customerName: z.string().optional(),
      customerContact: z.string().optional(),
      remarks: z.string().optional(),
      photos: z.array(z.object({
        uri: z.string(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        timestamp: z.string(),
      })).optional(),
      gpsLatitude: z.string().optional(),
      gpsLongitude: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      
      const VALID_FINANCE_TYPES = ['FIN_LC', 'FIN_LL_FTTH', 'FIN_TOWER', 'FIN_GSM_POSTPAID', 'FIN_RENT_BUILDING'];
      const VALID_PAYMENT_MODES = ['CASH', 'CHEQUE', 'NEFT', 'UPI', 'CARD', 'DD', 'OTHER'];
      
      if (!VALID_FINANCE_TYPES.includes(input.financeType)) {
        throw new Error(`Invalid finance type: ${input.financeType}`);
      }
      
      if (!VALID_PAYMENT_MODES.includes(input.paymentMode)) {
        throw new Error(`Invalid payment mode: ${input.paymentMode}`);
      }
      
      if (input.paymentMode !== 'CASH' && !input.transactionReference) {
        throw new Error(`Transaction reference is required for ${input.paymentMode} payments`);
      }
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      if (event[0].status === 'completed' || event[0].status === 'cancelled') {
        throw new Error(`Cannot submit collection for ${event[0].status} event`);
      }
      
      if (!event[0].category?.includes(input.financeType)) {
        throw new Error(`This event does not support ${input.financeType} collection type`);
      }
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      const isEventManager = event[0].assignedTo === input.employeeId;
      
      if (!assignment[0] && !isEventManager) {
        throw new Error("You are not assigned to this event. Please contact the event manager.");
      }
      
      const targetField = input.financeType === 'FIN_LC' ? 'targetFinLc' :
                         input.financeType === 'FIN_LL_FTTH' ? 'targetFinLlFtth' :
                         input.financeType === 'FIN_TOWER' ? 'targetFinTower' :
                         input.financeType === 'FIN_GSM_POSTPAID' ? 'targetFinGsmPostpaid' :
                         'targetFinRentBuilding';
      const collectedField = input.financeType === 'FIN_LC' ? 'finLcCollected' :
                            input.financeType === 'FIN_LL_FTTH' ? 'finLlFtthCollected' :
                            input.financeType === 'FIN_TOWER' ? 'finTowerCollected' :
                            input.financeType === 'FIN_GSM_POSTPAID' ? 'finGsmPostpaidCollected' :
                            'finRentBuildingCollected';
      
      const currentTarget = (event[0] as any)[targetField] || 0;
      const currentCollected = (event[0] as any)[collectedField] || 0;
      const newTotal = currentCollected + input.amountCollected;
      
      if (newTotal > currentTarget && currentTarget > 0) {
        console.log(`[FINANCE] Over-collection warning: ${input.financeType} target=${currentTarget}, collected=${currentCollected}, new entry=${input.amountCollected}, total=${newTotal}`);
      }
      
      const result = await db.insert(financeCollectionEntries).values({
        eventId: input.eventId,
        employeeId: input.employeeId,
        financeType: input.financeType,
        amountCollected: input.amountCollected,
        paymentMode: input.paymentMode,
        transactionReference: input.transactionReference,
        customerName: input.customerName,
        customerContact: input.customerContact,
        photos: input.photos || [],
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        remarks: input.remarks,
        approvalStatus: 'pending',
      }).returning();
      
      // Update the event's collected amount
      const updateData: Record<string, number> = {};
      updateData[collectedField] = newTotal;
      await db.update(events).set(updateData).where(eq(events.id, input.eventId));
      
      console.log(`[FINANCE] Updated ${collectedField} for event ${input.eventId}: ${currentCollected} -> ${newTotal}`);
      
      await db.insert(auditLogs).values({
        action: 'SUBMIT_FINANCE_COLLECTION',
        entityType: 'FINANCE',
        entityId: result[0].id,
        performedBy: input.employeeId,
        details: { eventId: input.eventId, financeType: input.financeType, amountCollected: input.amountCollected, paymentMode: input.paymentMode, status: 'pending' },
      });
      
      // Get submitter name for notification
      const submitter = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      const submitterName = submitter[0]?.name || 'Unknown';
      
      // Send notification to event creator for review
      if (event[0].assignedTo && event[0].assignedTo !== input.employeeId) {
        await db.insert(notifications).values({
          recipientId: event[0].assignedTo,
          type: 'FINANCE_COLLECTION_SUBMITTED',
          title: 'Finance Collection Pending Review',
          message: `${submitterName} submitted ₹${input.amountCollected.toLocaleString('en-IN')} collection (${input.financeType.replace('FIN_', '').replace(/_/g, ' ')}) for "${event[0].name}". Review required.`,
          entityType: 'EVENT',
          entityId: input.eventId,
          metadata: { 
            entryId: result[0].id, 
            financeType: input.financeType, 
            amount: input.amountCollected,
            submitterName,
            paymentMode: input.paymentMode 
          },
        });
      }
      
      return result[0];
    }),

  getFinanceCollectionEntries: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const entries = await db.select({
        entry: financeCollectionEntries,
        submitterName: employees.name,
        submitterDesignation: employees.designation,
      })
      .from(financeCollectionEntries)
      .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
      .where(eq(financeCollectionEntries.eventId, input.eventId))
      .orderBy(desc(financeCollectionEntries.createdAt));
      
      return entries.map(e => ({
        ...e.entry,
        submitterName: e.submitterName,
        submitterDesignation: e.submitterDesignation,
      }));
    }),
    
  getPendingFinanceCollections: publicProcedure
    .input(z.object({ 
      reviewerId: z.string().uuid(),
      financeType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      
      // Check if user has management role
      const reviewer = await db.select().from(employees).where(eq(employees.id, input.reviewerId)).limit(1);
      if (!reviewer[0] || !['CMD', 'ADMIN', 'GM', 'CGM', 'DGM', 'AGM'].includes(reviewer[0].role)) {
        throw new Error('Only management users can review finance collections');
      }
      
      // For senior managers (ADMIN, GM, CGM), show all pending collections in their circle
      // For DGM/AGM, show only their own events' collections
      const isTopManagement = ['CMD', 'ADMIN', 'GM', 'CGM'].includes(reviewer[0].role);
      
      let userEvents: { id: string; name: string }[];
      
      if (isTopManagement) {
        if (reviewer[0].role === 'ADMIN' || reviewer[0].role === 'CMD') {
          userEvents = await db.select({ id: events.id, name: events.name })
            .from(events)
            .where(sql`${events.taskCategory} LIKE 'FIN_%'`);
        } else {
          userEvents = await db.select({ id: events.id, name: events.name })
            .from(events)
            .where(and(
              sql`${events.taskCategory} LIKE 'FIN_%'`,
              eq(events.circle, reviewer[0].circle || '')
            ));
        }
      } else {
        userEvents = await db.select({ id: events.id, name: events.name })
          .from(events)
          .where(eq(events.assignedTo, input.reviewerId));
      }
      
      if (userEvents.length === 0) return [];
      
      const eventIds = userEvents.map(e => e.id);
      const eventTitleMap = new Map(userEvents.map(e => [e.id, e.name]));
      
      // Build filter conditions
      const conditions = [
        sql`${financeCollectionEntries.eventId} IN ${eventIds}`,
        eq(financeCollectionEntries.approvalStatus, 'pending')
      ];
      
      if (input.financeType) {
        conditions.push(eq(financeCollectionEntries.financeType, input.financeType));
      }
      
      // Get pending finance entries for these events
      const pendingEntries = await db.select({
        entry: financeCollectionEntries,
        submitterName: employees.name,
        submitterDesignation: employees.designation,
        submitterCircle: employees.circle,
      })
      .from(financeCollectionEntries)
      .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(financeCollectionEntries.createdAt))
      .limit(100);
      
      return pendingEntries.map(e => ({
        ...e.entry,
        submitterName: e.submitterName,
        submitterDesignation: e.submitterDesignation,
        submitterCircle: e.submitterCircle,
        eventTitle: eventTitleMap.get(e.entry.eventId) || 'Unknown Event',
      }));
    }),
    
  approveFinanceCollection: publicProcedure
    .input(z.object({
      entryId: z.string().uuid(),
      reviewerId: z.string().uuid(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      
      // Check if user has management role
      const reviewer = await db.select().from(employees).where(eq(employees.id, input.reviewerId)).limit(1);
      if (!reviewer[0] || !['CMD', 'ADMIN', 'GM', 'CGM', 'DGM', 'AGM'].includes(reviewer[0].role)) {
        throw new Error('Only management users can approve finance collections');
      }
      
      // Get the entry
      const entry = await db.select().from(financeCollectionEntries)
        .where(eq(financeCollectionEntries.id, input.entryId)).limit(1);
      
      if (!entry[0]) throw new Error('Finance collection entry not found');
      if (entry[0].approvalStatus !== 'pending') {
        throw new Error(`Entry already ${entry[0].approvalStatus}`);
      }
      
      // Verify reviewer owns the event
      const event = await db.select().from(events).where(eq(events.id, entry[0].eventId)).limit(1);
      if (!event[0]) throw new Error('Event not found');
      if (event[0].assignedTo !== input.reviewerId && !['CMD', 'ADMIN', 'GM', 'CGM'].includes(reviewer[0].role)) {
        throw new Error('You can only approve collections for events you manage');
      }
      
      // Update entry status
      await db.update(financeCollectionEntries)
        .set({
          approvalStatus: 'approved',
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
          reviewRemarks: input.remarks,
        })
        .where(eq(financeCollectionEntries.id, input.entryId));
      
      // Update event totals
      const updateFields: Record<string, any> = { updatedAt: new Date() };
      if (entry[0].financeType === 'FIN_LC') {
        updateFields.finLcCollected = (event[0].finLcCollected || 0) + entry[0].amountCollected;
      } else if (entry[0].financeType === 'FIN_LL_FTTH') {
        updateFields.finLlFtthCollected = (event[0].finLlFtthCollected || 0) + entry[0].amountCollected;
      } else if (entry[0].financeType === 'FIN_TOWER') {
        updateFields.finTowerCollected = (event[0].finTowerCollected || 0) + entry[0].amountCollected;
      } else if (entry[0].financeType === 'FIN_GSM_POSTPAID') {
        updateFields.finGsmPostpaidCollected = (event[0].finGsmPostpaidCollected || 0) + entry[0].amountCollected;
      } else if (entry[0].financeType === 'FIN_RENT_BUILDING') {
        updateFields.finRentBuildingCollected = (event[0].finRentBuildingCollected || 0) + entry[0].amountCollected;
      }
      
      await db.update(events).set(updateFields).where(eq(events.id, entry[0].eventId));
      
      // Create audit log
      await db.insert(auditLogs).values({
        action: 'APPROVE_FINANCE_COLLECTION',
        entityType: 'FINANCE',
        entityId: input.entryId,
        performedBy: input.reviewerId,
        details: { eventId: entry[0].eventId, amount: entry[0].amountCollected, financeType: entry[0].financeType },
      });
      
      // Notify the submitter
      await db.insert(notifications).values({
        recipientId: entry[0].employeeId,
        type: 'FINANCE_COLLECTION_APPROVED',
        title: 'Collection Approved',
        message: `Your ₹${entry[0].amountCollected.toLocaleString('en-IN')} collection for "${event[0].name}" has been approved.`,
        entityType: 'EVENT',
        entityId: entry[0].eventId,
        metadata: { entryId: input.entryId, amount: entry[0].amountCollected },
      });
      
      return { success: true };
    }),
    
  rejectFinanceCollection: publicProcedure
    .input(z.object({
      entryId: z.string().uuid(),
      reviewerId: z.string().uuid(),
      remarks: z.string().min(1, 'Rejection reason is required'),
    }))
    .mutation(async ({ input }) => {
      
      // Check if user has management role
      const reviewer = await db.select().from(employees).where(eq(employees.id, input.reviewerId)).limit(1);
      if (!reviewer[0] || !['CMD', 'ADMIN', 'GM', 'CGM', 'DGM', 'AGM'].includes(reviewer[0].role)) {
        throw new Error('Only management users can reject finance collections');
      }
      
      // Get the entry
      const entry = await db.select().from(financeCollectionEntries)
        .where(eq(financeCollectionEntries.id, input.entryId)).limit(1);
      
      if (!entry[0]) throw new Error('Finance collection entry not found');
      if (entry[0].approvalStatus !== 'pending') {
        throw new Error(`Entry already ${entry[0].approvalStatus}`);
      }
      
      // Verify reviewer owns the event
      const event = await db.select().from(events).where(eq(events.id, entry[0].eventId)).limit(1);
      if (!event[0]) throw new Error('Event not found');
      if (event[0].assignedTo !== input.reviewerId && !['CMD', 'ADMIN', 'GM', 'CGM'].includes(reviewer[0].role)) {
        throw new Error('You can only reject collections for events you manage');
      }
      
      // Update entry status
      await db.update(financeCollectionEntries)
        .set({
          approvalStatus: 'rejected',
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
          reviewRemarks: input.remarks,
        })
        .where(eq(financeCollectionEntries.id, input.entryId));
      
      // Create audit log
      await db.insert(auditLogs).values({
        action: 'REJECT_FINANCE_COLLECTION',
        entityType: 'FINANCE',
        entityId: input.entryId,
        performedBy: input.reviewerId,
        details: { eventId: entry[0].eventId, amount: entry[0].amountCollected, reason: input.remarks },
      });
      
      // Notify the submitter
      await db.insert(notifications).values({
        recipientId: entry[0].employeeId,
        type: 'FINANCE_COLLECTION_REJECTED',
        title: 'Collection Rejected',
        message: `Your ₹${entry[0].amountCollected.toLocaleString('en-IN')} collection for "${event[0].name}" was rejected. Reason: ${input.remarks}`,
        entityType: 'EVENT',
        entityId: entry[0].eventId,
        metadata: { entryId: input.entryId, amount: entry[0].amountCollected, reason: input.remarks },
      });
      
      return { success: true };
    }),

  getMyAssignedEvents: publicProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ input }) => {
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.employeeId, input.employeeId));
      
      const eventIds = assignments.map(a => a.eventId);
      if (eventIds.length === 0) return [];
      
      const assignedEvents = await db.select().from(events)
        .where(sql`${events.id} IN ${eventIds}`)
        .orderBy(desc(events.startDate));
      
      return assignedEvents.map(event => {
        const assignment = assignments.find(a => a.eventId === event.id);
        return {
          ...event,
          assignment,
        };
      });
    }),

  getAvailableTeamMembers: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      eventId: z.string().uuid().optional(),
      managerPurseId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      
      const masterRecords = await db.select().from(employeeMaster);
      const persNoMap = new Map<string, string>();
      const linkedEmployeeMap = new Map<string, string>();
      masterRecords.forEach(m => {
        if (m.linkedEmployeeId) {
          persNoMap.set(m.linkedEmployeeId, m.persNo);
          linkedEmployeeMap.set(m.persNo, m.linkedEmployeeId);
        }
      });
      
      let directReportPurseIds: string[] = [];
      if (input.managerPurseId) {
        directReportPurseIds = masterRecords
          .filter(m => m.reportingPersNo === input.managerPurseId)
          .map(m => m.persNo);
      }
      
      const directReportEmployeeIds = directReportPurseIds
        .map(pid => linkedEmployeeMap.get(pid))
        .filter((id): id is string => id !== undefined);
      
      let circleEmployees = await db.select().from(employees)
        .where(and(
          eq(employees.circle, input.circle),
          eq(employees.isActive, true)
        ));
      
      if (input.managerPurseId && directReportEmployeeIds.length > 0) {
        circleEmployees = circleEmployees.filter(emp => directReportEmployeeIds.includes(emp.id));
      } else if (input.managerPurseId && directReportEmployeeIds.length === 0) {
        circleEmployees = [];
      }
      
      let assignedIds: string[] = [];
      if (input.eventId) {
        const assignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        assignedIds = assignments.map(a => a.employeeId);
      }
      
      return circleEmployees.map(emp => ({
        ...emp,
        persNo: persNoMap.get(emp.id) || null,
        isAssigned: assignedIds.includes(emp.id),
      }));
    }),

  updateEventStatus: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const result = await db.update(events)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(events.id, input.eventId))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_EVENT_STATUS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        details: { status: input.status },
      });

      return result[0];
    }),

  updateTaskProgress: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      taskType: z.enum(['SIM', 'FTTH', 'EB', 'LEASE', 'BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL']),
      increment: z.number().int().default(1),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      // Verify user is assigned to this task
      const employee = await db.select().from(employees).where(eq(employees.id, input.updatedBy));
      if (!employee[0]) throw new Error("Employee not found");
      
      const employeePersNo = employee[0].persNo;
      const assignedTeam = (event[0].assignedTeam as string[]) || [];
      
      // Check if employee is in the assigned team (via persNo) or has an assignment record
      const hasAssignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.updatedBy)
        ));
      
      const isInAssignedTeam = employeePersNo && assignedTeam.includes(employeePersNo);
      const hasAssignmentRecord = hasAssignment.length > 0;
      
      if (!isInAssignedTeam && !hasAssignmentRecord) {
        throw new Error("You are not assigned to this task. Only assigned team members can update progress.");
      }

      if (hasAssignmentRecord) {
        const assignedTypes = (hasAssignment[0].assignedTaskTypes as string[]) || [];
        if (assignedTypes.length > 0) {
          const taskTypeToAssignedType: Record<string, string> = {
            'SIM': 'SIM', 'FTTH': 'FTTH', 'EB': 'EB', 'LEASE': 'LEASE_CIRCUIT',
            'BTS_DOWN': 'BTS_DOWN', 'FTTH_DOWN': 'FTTH_DOWN', 'ROUTE_FAIL': 'ROUTE_FAIL', 'OFC_FAIL': 'OFC_FAIL',
          };
          const requiredType = taskTypeToAssignedType[input.taskType];
          if (requiredType && !assignedTypes.includes(requiredType)) {
            throw new Error(`You are not assigned to ${input.taskType} tasks`);
          }
        }
      }
      
      const columnMap: Record<string, keyof typeof events> = {
        'EB': 'ebCompleted',
        'LEASE': 'leaseCompleted',
        'BTS_DOWN': 'btsDownCompleted',
        'FTTH_DOWN': 'ftthDownCompleted',
        'ROUTE_FAIL': 'routeFailCompleted',
        'OFC_FAIL': 'ofcFailCompleted',
      };
      
      const targetMap: Record<string, keyof typeof events> = {
        'EB': 'targetEb',
        'LEASE': 'targetLease',
        'BTS_DOWN': 'targetBtsDown',
        'FTTH_DOWN': 'targetFtthDown',
        'ROUTE_FAIL': 'targetRouteFail',
        'OFC_FAIL': 'targetOfcFail',
      };
      
      if (input.taskType === 'SIM' || input.taskType === 'FTTH') {
        throw new Error("SIM and FTTH progress is tracked through sales entries");
      }
      
      const completedColumn = columnMap[input.taskType];
      const targetColumn = targetMap[input.taskType];
      
      if (!completedColumn || !targetColumn) {
        throw new Error("Invalid task type");
      }
      
      const currentCompleted = (event[0] as any)[completedColumn] || 0;
      const target = (event[0] as any)[targetColumn] || 0;
      
      // Support both increment (+1) and decrement (-1) for undo
      let newCompleted = currentCompleted + input.increment;
      // Ensure value stays within bounds (0 to target)
      newCompleted = Math.max(0, Math.min(newCompleted, target));
      
      const result = await db.update(events)
        .set({ [completedColumn]: newCompleted, updatedAt: new Date() } as any)
        .where(eq(events.id, input.eventId))
        .returning();
      
      // Auto-update submission status to 'in_progress' if work is being done
      if (hasAssignmentRecord && hasAssignment[0].submissionStatus === 'not_started' && input.increment > 0) {
        await db.update(eventAssignments)
          .set({ submissionStatus: 'in_progress', updatedAt: new Date() })
          .where(eq(eventAssignments.id, hasAssignment[0].id));
      }
      
      await db.insert(auditLogs).values({
        action: 'UPDATE_TASK_PROGRESS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        timestamp: new Date(),
        details: { taskType: input.taskType, increment: input.increment, newCompleted },
      });
      
      return result[0];
    }),

  updateMemberTaskProgress: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      taskType: z.enum(['EB', 'LEASE', 'BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL']),
      increment: z.number().int().default(1),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      const memberCompletedMap: Record<string, keyof typeof eventAssignments.$inferSelect> = {
        'EB': 'ebCompleted',
        'LEASE': 'leaseCompleted',
        'BTS_DOWN': 'btsDownCompleted',
        'FTTH_DOWN': 'ftthDownCompleted',
        'ROUTE_FAIL': 'routeFailCompleted',
        'OFC_FAIL': 'ofcFailCompleted',
      };
      
      const memberTargetMap: Record<string, keyof typeof eventAssignments.$inferSelect> = {
        'EB': 'ebTarget',
        'LEASE': 'leaseTarget',
        'BTS_DOWN': 'btsDownTarget',
        'FTTH_DOWN': 'ftthDownTarget',
        'ROUTE_FAIL': 'routeFailTarget',
        'OFC_FAIL': 'ofcFailTarget',
      };
      
      const eventCompletedMap: Record<string, keyof typeof events.$inferSelect> = {
        'EB': 'ebCompleted',
        'LEASE': 'leaseCompleted',
        'BTS_DOWN': 'btsDownCompleted',
        'FTTH_DOWN': 'ftthDownCompleted',
        'ROUTE_FAIL': 'routeFailCompleted',
        'OFC_FAIL': 'ofcFailCompleted',
      };
      
      const eventStartedAtMap: Record<string, string> = {
        'EB': 'ebStartedAt',
        'LEASE': 'leaseStartedAt',
        'BTS_DOWN': 'btsDownStartedAt',
        'FTTH_DOWN': 'ftthDownStartedAt',
        'ROUTE_FAIL': 'routeFailStartedAt',
        'OFC_FAIL': 'ofcFailStartedAt',
      };
      
      const completedColumn = memberCompletedMap[input.taskType];
      const targetColumn = memberTargetMap[input.taskType];
      const eventCompletedColumn = eventCompletedMap[input.taskType];
      const eventStartedAtColumn = eventStartedAtMap[input.taskType];

      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");

      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      if (!assignment[0]) throw new Error("Team member assignment not found");

      const assignedTypes = (assignment[0].assignedTaskTypes as string[]) || [];
      if (assignedTypes.length > 0) {
        const taskTypeToAssignedType: Record<string, string> = {
          'EB': 'EB',
          'LEASE': 'LEASE_CIRCUIT',
          'BTS_DOWN': 'BTS_DOWN',
          'FTTH_DOWN': 'FTTH_DOWN',
          'ROUTE_FAIL': 'ROUTE_FAIL',
          'OFC_FAIL': 'OFC_FAIL',
        };
        const requiredType = taskTypeToAssignedType[input.taskType];
        if (requiredType && !assignedTypes.includes(requiredType)) {
          throw new Error(`You are not assigned to ${input.taskType} tasks. Your assigned types: ${assignedTypes.join(', ')}`);
        }
      }

      const currentMemberCompleted = (assignment[0] as any)[completedColumn] || 0;
      let memberTarget = (assignment[0] as any)[targetColumn] || 0;

      if (memberTarget === 0) {
        const eventTargetMap: Record<string, keyof typeof events.$inferSelect> = {
          'EB': 'targetEb',
          'LEASE': 'targetLease',
          'BTS_DOWN': 'targetBtsDown',
          'FTTH_DOWN': 'targetFtthDown',
          'ROUTE_FAIL': 'targetRouteFail',
          'OFC_FAIL': 'targetOfcFail',
        };
        const eventTargetColumn = eventTargetMap[input.taskType];
        const eventTarget = (event[0] as any)[eventTargetColumn] || 0;

        const allAssignmentsForDistribution = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        const teamSize = allAssignmentsForDistribution.length;
        const memberIdx = allAssignmentsForDistribution.findIndex(a => a.employeeId === input.employeeId);

        if (teamSize > 0) {
          const baseTarget = Math.floor(eventTarget / teamSize);
          const remainder = eventTarget % teamSize;
          memberTarget = baseTarget + (memberIdx < remainder ? 1 : 0);
        }
      }

      let newMemberCompleted = currentMemberCompleted + input.increment;
      newMemberCompleted = Math.max(0, Math.min(newMemberCompleted, memberTarget));

      await db.update(eventAssignments)
        .set({ [completedColumn]: newMemberCompleted, updatedAt: new Date() } as any)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));

      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      const totalCompleted = allAssignments.reduce((sum, a) => sum + ((a as any)[completedColumn] || 0), 0);

      const currentStartedAt = (event[0] as any)[eventStartedAtColumn];
      const updateData: any = { 
        [eventCompletedColumn]: totalCompleted, 
        updatedAt: new Date() 
      };
      if (!currentStartedAt && totalCompleted > 0) {
        updateData[eventStartedAtColumn] = new Date();
      }

      const result = await db.update(events)
        .set(updateData)
        .where(eq(events.id, input.eventId))
        .returning();

      const omTypes = ['BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL'];
      const salesTypes = ['EB', 'LEASE'];

      if (input.increment > 0) {
        try {
          if (omTypes.includes(input.taskType)) {
            await db.insert(maintenanceEntries).values({
              eventId: input.eventId,
              employeeId: input.employeeId,
              taskType: input.taskType,
              increment: input.increment,
            });
          } else if (salesTypes.includes(input.taskType)) {
            await db.insert(eventSalesEntries).values({
              eventId: input.eventId,
              employeeId: input.employeeId,
              simsSold: 0,
              simsActivated: 0,
              ftthSold: 0,
              ftthActivated: 0,
              leaseSold: input.taskType === 'LEASE' ? input.increment : 0,
              ebSold: input.taskType === 'EB' ? input.increment : 0,
              customerType: 'B2C',
            });
          }
        } catch (entryError) {
          console.error(`Failed to create entry record for ${input.taskType}:`, entryError);
        }
      }

      await db.insert(auditLogs).values({
        action: 'UPDATE_MEMBER_TASK_PROGRESS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        timestamp: new Date(),
        details: { 
          taskType: input.taskType, 
          employeeId: input.employeeId,
          increment: input.increment, 
          newMemberCompleted,
          totalCompleted,
        },
      });

      return { 
        memberCompleted: newMemberCompleted, 
        memberTarget,
        totalCompleted,
        event: result[0] 
      };
    }),

  getTaskProgress: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const e = event[0];
      return {
        sim: { target: e.allocatedSim || e.targetSim, completed: 0 },
        ftth: { target: e.allocatedFtth || e.targetFtth, completed: 0 },
        eb: { target: e.targetEb, completed: e.ebCompleted },
        lease: { target: e.targetLease, completed: e.leaseCompleted },
        btsDown: { target: e.targetBtsDown, completed: e.btsDownCompleted },
        ftthDown: { target: e.targetFtthDown, completed: e.ftthDownCompleted },
        routeFail: { target: e.targetRouteFail, completed: e.routeFailCompleted },
        ofcFail: { target: e.targetOfcFail, completed: e.ofcFailCompleted },
      };
    }),

  createSubtask: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      assignedTo: z.string().uuid().optional(),
      staffId: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      dueDate: z.string().optional(),
      simAllocated: z.number().int().min(0).default(0),
      ftthAllocated: z.number().int().min(0).default(0),
      createdBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      let assignedEmployeeId = input.assignedTo;
      
      if (input.staffId && !assignedEmployeeId) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, input.staffId));
        if (masterRecord[0]?.linkedEmployeeId) {
          assignedEmployeeId = masterRecord[0].linkedEmployeeId;
        }
      }
      
      if (assignedEmployeeId) {
        const existingAssignment = await db.select().from(eventAssignments)
          .where(and(
            eq(eventAssignments.eventId, input.eventId),
            eq(eventAssignments.employeeId, assignedEmployeeId)
          ));
        
        if (!existingAssignment[0]) {
          await db.insert(eventAssignments).values({
            eventId: input.eventId,
            employeeId: assignedEmployeeId,
            simTarget: 0,
            ftthTarget: 0,
            assignedBy: input.createdBy,
          });
          
          const event = await db.select().from(events).where(eq(events.id, input.eventId));
          if (event[0]) {
            const currentTeam = (event[0].assignedTeam || []) as string[];
            if (!currentTeam.includes(assignedEmployeeId)) {
              await db.update(events)
                .set({ assignedTeam: [...currentTeam, assignedEmployeeId], updatedAt: new Date() })
                .where(eq(events.id, input.eventId));
            }
          }
          
          await db.insert(auditLogs).values({
            action: 'AUTO_ASSIGN_TEAM_MEMBER',
            entityType: 'EVENT',
            entityId: input.eventId,
            performedBy: input.createdBy,
            details: { employeeId: assignedEmployeeId, reason: 'subtask_assignment' },
          });
        }
      }
      
      const result = await db.insert(eventSubtasks).values({
        eventId: input.eventId,
        title: input.title,
        description: input.description,
        assignedTo: assignedEmployeeId,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        simAllocated: input.simAllocated,
        ftthAllocated: input.ftthAllocated,
        createdBy: input.createdBy,
      }).returning();

      await db.insert(auditLogs).values({
        action: 'CREATE_SUBTASK',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.createdBy,
        details: { subtaskId: result[0].id, title: input.title, assignedTo: assignedEmployeeId },
      });

      if (assignedEmployeeId && assignedEmployeeId !== input.createdBy) {
        const event = await db.select({ name: events.name }).from(events).where(eq(events.id, input.eventId));
        const creator = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, input.createdBy));
        if (event[0] && creator[0]) {
          notifySubtaskAssigned(
            assignedEmployeeId,
            result[0].id,
            input.title,
            event[0].name,
            creator[0].name,
            input.dueDate
          ).catch(err => console.error('Failed to notify subtask assignment:', err));
        }
      }

      return result[0];
    }),

  updateSubtask: publicProcedure
    .input(z.object({
      subtaskId: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      dueDate: z.string().nullable().optional(),
      simAllocated: z.number().int().min(0).optional(),
      ftthAllocated: z.number().int().min(0).optional(),
      simSold: z.number().int().min(0).optional(),
      ftthSold: z.number().int().min(0).optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const { subtaskId, updatedBy, dueDate, ...updateData } = input;
      
      const oldSubtask = await db.select().from(eventSubtasks).where(eq(eventSubtasks.id, subtaskId));
      const previousAssignee = oldSubtask[0]?.assignedTo;
      
      const updateValues: Record<string, unknown> = { ...updateData, updatedAt: new Date() };
      if (dueDate !== undefined) {
        updateValues.dueDate = dueDate ? new Date(dueDate) : null;
      }
      
      if (input.status === 'completed') {
        updateValues.completedAt = new Date();
        updateValues.completedBy = updatedBy;
      }
      
      const result = await db.update(eventSubtasks)
        .set(updateValues)
        .where(eq(eventSubtasks.id, subtaskId))
        .returning();

      if (result[0]) {
        await db.insert(auditLogs).values({
          action: 'UPDATE_SUBTASK',
          entityType: 'EVENT',
          entityId: result[0].eventId,
          performedBy: updatedBy,
          details: { subtaskId, changes: updateData },
        });

        if (input.assignedTo !== undefined && input.assignedTo !== previousAssignee && input.assignedTo && input.assignedTo !== updatedBy) {
          const event = await db.select({ name: events.name }).from(events).where(eq(events.id, result[0].eventId));
          const updater = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, updatedBy));
          if (event[0] && updater[0]) {
            notifySubtaskReassigned(
              input.assignedTo,
              subtaskId,
              result[0].title,
              event[0].name,
              updater[0].name,
              result[0].dueDate?.toISOString()
            ).catch(err => console.error('Failed to notify subtask reassignment:', err));
          }
        }

        if (input.status === 'completed' && result[0].createdBy && result[0].createdBy !== updatedBy) {
          const completedByEmployee = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, updatedBy));
          if (completedByEmployee[0]) {
            notifySubtaskCompleted(
              result[0].createdBy,
              subtaskId,
              result[0].title,
              completedByEmployee[0].name
            ).catch(err => console.error('Failed to notify subtask completion:', err));
          }
        }
      }

      return result[0];
    }),

  deleteSubtask: publicProcedure
    .input(z.object({
      subtaskId: z.string().uuid(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const subtask = await db.select().from(eventSubtasks).where(eq(eventSubtasks.id, input.subtaskId));
      
      await db.delete(eventSubtasks).where(eq(eventSubtasks.id, input.subtaskId));

      if (subtask[0]) {
        await db.insert(auditLogs).values({
          action: 'DELETE_SUBTASK',
          entityType: 'EVENT',
          entityId: subtask[0].eventId,
          performedBy: input.deletedBy,
          details: { subtaskId: input.subtaskId, title: subtask[0].title },
        });
      }

      return { success: true };
    }),

  updateTeamMemberTargets: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string(),
      simTarget: z.number().min(0),
      ftthTarget: z.number().min(0),
      leaseTarget: z.number().min(0).optional(),
      ebTarget: z.number().min(0).optional(),
      assignedTaskTypes: z.array(z.string()).optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const leaseTarget = input.leaseTarget ?? 0;
      const ebTarget = input.ebTarget ?? 0;
      
      let assignedTaskTypes = input.assignedTaskTypes;
      if (!assignedTaskTypes) {
        assignedTaskTypes = [];
        if (input.simTarget > 0) assignedTaskTypes.push('SIM');
        if (input.ftthTarget > 0) assignedTaskTypes.push('FTTH');
        if (leaseTarget > 0) assignedTaskTypes.push('LEASE_CIRCUIT');
        if (ebTarget > 0) assignedTaskTypes.push('EB');
      }
      
      const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.employeeId);
      
      let actualEmployeeId = input.employeeId;
      
      if (!isUUID) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, input.employeeId));
        
        if (!masterRecord[0]) {
          throw new Error("Employee not found in master data");
        }
        
        if (!masterRecord[0].linkedEmployeeId) {
          throw new Error("Employee is not linked to a user account. Please activate the employee first.");
        }
        
        actualEmployeeId = masterRecord[0].linkedEmployeeId;
      }
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      let currentAssignment = allAssignments.find(a => a.employeeId === actualEmployeeId);
      
      if (!currentAssignment) {
        const otherAssignments = allAssignments;
        const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
        const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
        const currentLeaseDistributed = otherAssignments.reduce((sum, a) => sum + a.leaseTarget, 0);
        const currentEbDistributed = otherAssignments.reduce((sum, a) => sum + a.ebTarget, 0);
        
        const newTotalSim = currentSimDistributed + Math.floor(input.simTarget);
        const newTotalFtth = currentFtthDistributed + Math.floor(input.ftthTarget);
        const newTotalLease = currentLeaseDistributed + Math.floor(leaseTarget);
        const newTotalEb = currentEbDistributed + Math.floor(ebTarget);
        
        const maxSim = event[0].targetSim || event[0].allocatedSim;
        const maxFtth = event[0].targetFtth || event[0].allocatedFtth;
        const maxLease = event[0].targetLease || 0;
        const maxEb = event[0].targetEb || 0;
        
        if (maxSim > 0 && newTotalSim > maxSim) {
          const available = maxSim - currentSimDistributed;
          throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution (Total target: ${maxSim}).`);
        }
        
        if (maxFtth > 0 && newTotalFtth > maxFtth) {
          const available = maxFtth - currentFtthDistributed;
          throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution (Total target: ${maxFtth}).`);
        }
        
        if (maxLease > 0 && newTotalLease > maxLease) {
          const available = maxLease - currentLeaseDistributed;
          throw new Error(`Cannot assign ${leaseTarget} Lease Circuit. Only ${available} available for distribution (Total target: ${maxLease}).`);
        }
        
        if (maxEb > 0 && newTotalEb > maxEb) {
          const available = maxEb - currentEbDistributed;
          throw new Error(`Cannot assign ${ebTarget} EB. Only ${available} available for distribution (Total target: ${maxEb}).`);
        }
        
        const newAssignment = await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: actualEmployeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          leaseTarget: leaseTarget,
          ebTarget: ebTarget,
          assignedTaskTypes: assignedTaskTypes,
          assignedBy: input.updatedBy,
        }).returning();
        
        await db.insert(auditLogs).values({
          action: 'CREATE_TEAM_TARGETS',
          entityType: 'EVENT',
          entityId: input.eventId,
          performedBy: input.updatedBy,
          details: { employeeId: actualEmployeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget, leaseTarget, ebTarget, assignedTaskTypes },
        });
        
        return newAssignment[0];
      }
      
      if (input.simTarget < currentAssignment.simSold) {
        throw new Error(`Cannot set SIM target below already sold amount (${currentAssignment.simSold})`);
      }
      if (input.ftthTarget < currentAssignment.ftthSold) {
        throw new Error(`Cannot set FTTH target below already sold amount (${currentAssignment.ftthSold})`);
      }
      if (leaseTarget < currentAssignment.leaseCompleted) {
        throw new Error(`Cannot set Lease target below already completed amount (${currentAssignment.leaseCompleted})`);
      }
      if (ebTarget < currentAssignment.ebCompleted) {
        throw new Error(`Cannot set EB target below already completed amount (${currentAssignment.ebCompleted})`);
      }
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== actualEmployeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      const currentLeaseDistributed = otherAssignments.reduce((sum, a) => sum + a.leaseTarget, 0);
      const currentEbDistributed = otherAssignments.reduce((sum, a) => sum + a.ebTarget, 0);
      
      const newTotalSim = currentSimDistributed + Math.floor(input.simTarget);
      const newTotalFtth = currentFtthDistributed + Math.floor(input.ftthTarget);
      const newTotalLease = currentLeaseDistributed + Math.floor(leaseTarget);
      const newTotalEb = currentEbDistributed + Math.floor(ebTarget);
      
      const maxSim = event[0].targetSim || event[0].allocatedSim;
      const maxFtth = event[0].targetFtth || event[0].allocatedFtth;
      const maxLease = event[0].targetLease || 0;
      const maxEb = event[0].targetEb || 0;
      
      if (maxSim > 0 && newTotalSim > maxSim) {
        const available = maxSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution (Total target: ${maxSim}).`);
      }
      
      if (maxFtth > 0 && newTotalFtth > maxFtth) {
        const available = maxFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution (Total target: ${maxFtth}).`);
      }
      
      if (maxLease > 0 && newTotalLease > maxLease) {
        const available = maxLease - currentLeaseDistributed;
        throw new Error(`Cannot assign ${leaseTarget} Lease Circuit. Only ${available} available for distribution (Total target: ${maxLease}).`);
      }
      
      if (maxEb > 0 && newTotalEb > maxEb) {
        const available = maxEb - currentEbDistributed;
        throw new Error(`Cannot assign ${ebTarget} EB. Only ${available} available for distribution (Total target: ${maxEb}).`);
      }
      
      const result = await db.update(eventAssignments)
        .set({
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          leaseTarget: leaseTarget,
          ebTarget: ebTarget,
          assignedTaskTypes: assignedTaskTypes,
          updatedAt: new Date(),
        })
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, actualEmployeeId)
        ))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_TEAM_TARGETS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        details: { employeeId: actualEmployeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget, leaseTarget, ebTarget, assignedTaskTypes },
      });

      return result[0];
    }),

  getCircleResourceDashboard: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      
      const circleResources = await db.select().from(resources)
        .where(eq(resources.circle, input.circle));
      
      const simResource = circleResources.find(r => r.type === 'SIM');
      const ftthResource = circleResources.find(r => r.type === 'FTTH');
      
      const circleEvents = await db.select().from(events)
        .where(eq(events.circle, input.circle));
      
      const eventIds = circleEvents.map(e => e.id);
      let allAssignments: any[] = [];
      if (eventIds.length > 0) {
        allAssignments = await db.select().from(eventAssignments)
          .where(sql`${eventAssignments.eventId} IN ${eventIds}`);
      }
      
      // Get actual sales from event_sales_entries
      let circleSalesMap = new Map<string, { totalSimsSold: number; totalFtthSold: number }>();
      if (eventIds.length > 0) {
        const circleSalesEntrySums = await db.select({
          eventId: eventSalesEntries.eventId,
          totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
          totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        }).from(eventSalesEntries).where(sql`${eventSalesEntries.eventId} IN ${eventIds}`).groupBy(eventSalesEntries.eventId);
        circleSalesMap = new Map(circleSalesEntrySums.map(s => [s.eventId, { totalSimsSold: Number(s.totalSimsSold), totalFtthSold: Number(s.totalFtthSold) }]));
      }
      
      const eventSummaries = circleEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const salesData = circleSalesMap.get(event.id);
        const simSold = salesData?.totalSimsSold || 0;
        const ftthSold = salesData?.totalFtthSold || 0;
        
        return {
          id: event.id,
          name: event.name,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          resources: {
            sim: { allocated: event.allocatedSim, distributed: simDistributed, sold: simSold, remaining: event.allocatedSim - simSold },
            ftth: { allocated: event.allocatedFtth, distributed: ftthDistributed, sold: ftthSold, remaining: event.allocatedFtth - ftthSold },
          },
        };
      });
      
      const totalSimSoldAll = Array.from(circleSalesMap.values()).reduce((sum, s) => sum + s.totalSimsSold, 0);
      const totalFtthSoldAll = Array.from(circleSalesMap.values()).reduce((sum, s) => sum + s.totalFtthSold, 0);
      
      return {
        circle: input.circle,
        inventory: {
          sim: simResource ? { total: simResource.total, allocated: simResource.allocated, used: simResource.used, remaining: simResource.remaining } : null,
          ftth: ftthResource ? { total: ftthResource.total, allocated: ftthResource.allocated, used: ftthResource.used, remaining: ftthResource.remaining } : null,
        },
        events: eventSummaries,
        totals: {
          simAllocated: circleEvents.reduce((sum, e) => sum + e.allocatedSim, 0),
          ftthAllocated: circleEvents.reduce((sum, e) => sum + e.allocatedFtth, 0),
          simSold: totalSimSoldAll,
          ftthSold: totalFtthSoldAll,
        },
      };
    }),

  getHierarchicalReport: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId));
      if (!employee[0]) throw new Error("Employee not found");
      
      const createdEvents = await db.select().from(events)
        .where(eq(events.createdBy, input.employeeId));
      
      const managedEvents = await db.select().from(events)
        .where(eq(events.assignedTo, input.employeeId));
      
      const allEventIds = [...new Set([...createdEvents.map(e => e.id), ...managedEvents.map(e => e.id)])];
      
      let allAssignments: any[] = [];
      if (allEventIds.length > 0) {
        allAssignments = await db.select().from(eventAssignments)
          .where(sql`${eventAssignments.eventId} IN ${allEventIds}`);
      }
      
      // Get actual sales from event_sales_entries
      let hierSalesMap = new Map<string, { totalSimsSold: number; totalFtthSold: number }>();
      if (allEventIds.length > 0) {
        const hierSalesEntrySums = await db.select({
          eventId: eventSalesEntries.eventId,
          totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
          totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        }).from(eventSalesEntries).where(sql`${eventSalesEntries.eventId} IN ${allEventIds}`).groupBy(eventSalesEntries.eventId);
        hierSalesMap = new Map(hierSalesEntrySums.map(s => [s.eventId, { totalSimsSold: Number(s.totalSimsSold), totalFtthSold: Number(s.totalFtthSold) }]));
      }
      
      const allEvents = [...createdEvents, ...managedEvents.filter(e => !createdEvents.find(c => c.id === e.id))];
      
      const eventReports = allEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const salesData = hierSalesMap.get(event.id);
        const simSold = salesData?.totalSimsSold || 0;
        const ftthSold = salesData?.totalFtthSold || 0;
        
        return {
          id: event.id,
          name: event.name,
          circle: event.circle,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          isCreator: event.createdBy === input.employeeId,
          isManager: event.assignedTo === input.employeeId,
          teamCount: eventAssigns.length,
          resources: {
            sim: { allocated: event.allocatedSim, distributed: simDistributed, sold: simSold, remaining: event.allocatedSim - simSold },
            ftth: { allocated: event.allocatedFtth, distributed: ftthDistributed, sold: ftthSold, remaining: event.allocatedFtth - ftthSold },
          },
        };
      });
      
      return {
        employee: { id: employee[0].id, name: employee[0].name, role: employee[0].role, circle: employee[0].circle },
        eventsManaged: eventReports.length,
        summary: {
          totalSimAllocated: eventReports.reduce((sum, e) => sum + e.resources.sim.allocated, 0),
          totalFtthAllocated: eventReports.reduce((sum, e) => sum + e.resources.ftth.allocated, 0),
          totalSimSold: eventReports.reduce((sum, e) => sum + e.resources.sim.sold, 0),
          totalFtthSold: eventReports.reduce((sum, e) => sum + e.resources.ftth.sold, 0),
        },
        events: eventReports,
      };
    }),

  getMyAssignedTasks: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]) {
        return [];
      }
      
      const employeePersNo = employee[0].persNo;
      
      // Get events where employee has direct assignment in event_assignments table
      const myAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.employeeId, input.employeeId));
      
      const assignedEventIds = myAssignments.map(a => a.eventId);
      
      // Get events where employee is in assignedTeam array (by persNo)
      let teamEventIds: string[] = [];
      if (employeePersNo) {
        const eventsWithPersNoAssignment = await db.select({ id: events.id })
          .from(events)
          .where(sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem = ${employeePersNo})`);
        teamEventIds = eventsWithPersNoAssignment.map(e => e.id);
      }
      
      // Get events where employee is the assigned manager (assignedTo)
      const managerEvents = await db.select({ id: events.id })
        .from(events)
        .where(eq(events.assignedTo, input.employeeId));
      const managerEventIds = managerEvents.map(e => e.id);
      
      // Get events where employee is the creator
      const creatorEvents = await db.select({ id: events.id })
        .from(events)
        .where(eq(events.createdBy, input.employeeId));
      const creatorEventIds = creatorEvents.map(e => e.id);
      
      // Combine all event IDs (deduplicated)
      const allEventIds = [...new Set([...assignedEventIds, ...teamEventIds, ...managerEventIds, ...creatorEventIds])];
      
      if (allEventIds.length === 0) {
        return [];
      }
      
      const myEvents = await db.select().from(events)
        .where(and(
          inArray(events.id, allEventIds),
          sql`${events.status} != 'draft'`
        ))
        .orderBy(desc(events.createdAt));
      
      const assignmentMap = new Map(myAssignments.map(a => [a.eventId, a]));
      
      const allTeamPersNos = new Set<string>();
      for (const event of myEvents) {
        const team = (event.assignedTeam as string[] || []);
        for (const pn of team) allTeamPersNos.add(pn);
      }
      
      let persNoNameMap = new Map<string, string>();
      if (allTeamPersNos.size > 0) {
        const persNoArr = [...allTeamPersNos];
        const empRows = await db.select({ persNo: employees.persNo, name: employees.name })
          .from(employees)
          .where(inArray(employees.persNo, persNoArr));
        for (const row of empRows) {
          if (row.persNo) persNoNameMap.set(row.persNo, row.name);
        }
        const missingPersNos = persNoArr.filter(p => !persNoNameMap.has(p));
        if (missingPersNos.length > 0) {
          const masterRows = await db.select({ persNo: employeeMaster.persNo, name: employeeMaster.name })
            .from(employeeMaster)
            .where(inArray(employeeMaster.persNo, missingPersNos));
          for (const row of masterRows) {
            if (row.persNo) persNoNameMap.set(row.persNo, row.name);
          }
        }
      }

      const allEventAssignments = myEvents.length > 0
        ? await db.select().from(eventAssignments)
            .where(inArray(eventAssignments.eventId, myEvents.map(e => e.id)))
        : [];
      const eventAssignmentsMap = new Map<string, typeof allEventAssignments>();
      for (const ea of allEventAssignments) {
        const arr = eventAssignmentsMap.get(ea.eventId) || [];
        arr.push(ea);
        eventAssignmentsMap.set(ea.eventId, arr);
      }
      
      return myEvents.map(event => {
        const assignment = assignmentMap.get(event.id);
        const eventCategories = (event.category || '').split(',').filter(Boolean);
        const eventHasSIM = eventCategories.includes('SIM');
        const eventHasFTTH = eventCategories.includes('FTTH');
        const eventHasLease = eventCategories.includes('LEASE_CIRCUIT');
        const eventHasBtsDown = eventCategories.includes('BTS_DOWN');
        const eventHasRouteFail = eventCategories.includes('ROUTE_FAIL');
        const eventHasFtthDown = eventCategories.includes('FTTH_DOWN');
        const eventHasOfcFail = eventCategories.includes('OFC_FAIL');
        const eventHasEb = eventCategories.includes('EB');
        
        const teamPersNos = (event.assignedTeam as string[] || []);
        const teamSize = teamPersNos.length || 1;
        const teamIndex = employeePersNo ? teamPersNos.indexOf(employeePersNo) : 0;
        const effectiveIndex = teamIndex >= 0 ? teamIndex : 0;
        
        const getDistributedTarget = (total: number) => {
          const base = Math.floor(total / teamSize);
          const remainder = total % teamSize;
          return effectiveIndex < remainder ? base + 1 : base;
        };
        
        const isCreator = event.createdBy === input.employeeId;
        const isManager = event.assignedTo === input.employeeId;
        const isTeamMember = employeePersNo ? teamPersNos.includes(employeePersNo) : false;
        const hasDirectAssignment = !!assignment;
        
        let myRole: 'creator' | 'manager' | 'team_member' | 'assigned' = 'team_member';
        if (isCreator) myRole = 'creator';
        else if (isManager) myRole = 'manager';
        else if (hasDirectAssignment) myRole = 'assigned';

        const teamMembers = teamPersNos.map(pn => ({
          persNo: pn,
          name: persNoNameMap.get(pn) || pn,
        }));

        if (isCreator && !isTeamMember && !hasDirectAssignment) {
          const hasSIM = eventHasSIM;
          const hasFTTH = eventHasFTTH;
          const hasLease = eventHasLease;
          const hasBtsDown = eventHasBtsDown;
          const hasRouteFail = eventHasRouteFail;
          const hasFtthDown = eventHasFtthDown;
          const hasOfcFail = eventHasOfcFail;
          const hasEb = eventHasEb;
          
          const allCategoryLabels: string[] = [];
          if (hasSIM) allCategoryLabels.push('SIM');
          if (hasFTTH) allCategoryLabels.push('FTTH');
          if (hasLease) allCategoryLabels.push('LEASE_CIRCUIT');
          if (hasBtsDown) allCategoryLabels.push('BTS_DOWN');
          if (hasRouteFail) allCategoryLabels.push('ROUTE_FAIL');
          if (hasFtthDown) allCategoryLabels.push('FTTH_DOWN');
          if (hasOfcFail) allCategoryLabels.push('OFC_FAIL');
          if (hasEb) allCategoryLabels.push('EB');

          const eventAssigns = eventAssignmentsMap.get(event.id) || [];
          const totalSimSold = eventAssigns.reduce((sum, a) => sum + (a.simSold ?? 0), 0);
          const totalFtthSold = eventAssigns.reduce((sum, a) => sum + (a.ftthSold ?? 0), 0);
          
          return {
            id: event.id,
            name: event.name,
            location: event.location,
            circle: event.circle,
            zone: event.zone,
            startDate: event.startDate,
            endDate: event.endDate,
            status: event.status,
            category: allCategoryLabels.join(','),
            myRole,
            isCreator,
            isManager,
            isTeamMember,
            hasDirectAssignment,
            assignmentId: null as string | null,
            teamMembers,
            myTargets: {
              sim: eventHasSIM ? event.targetSim : 0,
              ftth: eventHasFTTH ? event.targetFtth : 0,
              lease: eventHasLease ? (event.targetLease ?? 0) : 0,
              btsDown: eventHasBtsDown ? (event.targetBtsDown ?? 0) : 0,
              routeFail: eventHasRouteFail ? (event.targetRouteFail ?? 0) : 0,
              ftthDown: eventHasFtthDown ? (event.targetFtthDown ?? 0) : 0,
              ofcFail: eventHasOfcFail ? (event.targetOfcFail ?? 0) : 0,
              eb: eventHasEb ? (event.targetEb ?? 0) : 0,
            },
            myProgress: {
              simSold: totalSimSold,
              ftthSold: totalFtthSold,
            },
            maintenanceProgress: {
              lease: event.leaseCompleted ?? 0,
              leaseTarget: event.targetLease ?? 0,
              btsDown: event.btsDownCompleted ?? 0,
              btsDownTarget: event.targetBtsDown ?? 0,
              routeFail: event.routeFailCompleted ?? 0,
              routeFailTarget: event.targetRouteFail ?? 0,
              ftthDown: event.ftthDownCompleted ?? 0,
              ftthDownTarget: event.targetFtthDown ?? 0,
              ofcFail: event.ofcFailCompleted ?? 0,
              ofcFailTarget: event.targetOfcFail ?? 0,
              eb: event.ebCompleted ?? 0,
              ebTarget: event.targetEb ?? 0,
            },
            categories: {
              hasSIM,
              hasFTTH,
              hasLease,
              hasBtsDown,
              hasRouteFail,
              hasFtthDown,
              hasOfcFail,
              hasEb,
            },
            submissionStatus: (() => {
              const hasProgress = 
                totalSimSold > 0 || 
                totalFtthSold > 0 ||
                (event.leaseCompleted ?? 0) > 0 ||
                (event.btsDownCompleted ?? 0) > 0 ||
                (event.routeFailCompleted ?? 0) > 0 ||
                (event.ftthDownCompleted ?? 0) > 0 ||
                (event.ofcFailCompleted ?? 0) > 0 ||
                (event.ebCompleted ?? 0) > 0;
              return hasProgress ? 'in_progress' : 'not_started';
            })(),
            submittedAt: null as string | null,
            reviewedAt: null as string | null,
            rejectionReason: null as string | null,
          };
        }
        
        const mySimTarget = assignment
          ? assignment.simTarget
          : (eventHasSIM ? getDistributedTarget(event.targetSim) : 0);
        const myFtthTarget = assignment
          ? assignment.ftthTarget
          : (eventHasFTTH ? getDistributedTarget(event.targetFtth) : 0);
        const myLeaseTarget = eventHasLease ? getDistributedTarget(event.targetLease ?? 0) : 0;
        const myBtsDownTarget = eventHasBtsDown ? getDistributedTarget(event.targetBtsDown ?? 0) : 0;
        const myRouteFailTarget = eventHasRouteFail ? getDistributedTarget(event.targetRouteFail ?? 0) : 0;
        const myFtthDownTarget = eventHasFtthDown ? getDistributedTarget(event.targetFtthDown ?? 0) : 0;
        const myOfcFailTarget = eventHasOfcFail ? getDistributedTarget(event.targetOfcFail ?? 0) : 0;
        const myEbTarget = eventHasEb ? getDistributedTarget(event.targetEb ?? 0) : 0;
        
        const hasSIM = assignment ? assignment.simTarget > 0 : eventHasSIM;
        const hasFTTH = assignment ? assignment.ftthTarget > 0 : eventHasFTTH;
        const hasLease = assignment ? false : eventHasLease;
        const hasBtsDown = assignment ? false : eventHasBtsDown;
        const hasRouteFail = assignment ? false : eventHasRouteFail;
        const hasFtthDown = assignment ? false : eventHasFtthDown;
        const hasOfcFail = assignment ? false : eventHasOfcFail;
        const hasEb = assignment ? false : eventHasEb;
        
        const assignedCategoryLabels: string[] = [];
        if (hasSIM) assignedCategoryLabels.push('SIM');
        if (hasFTTH) assignedCategoryLabels.push('FTTH');
        if (hasLease) assignedCategoryLabels.push('LEASE_CIRCUIT');
        if (hasBtsDown) assignedCategoryLabels.push('BTS_DOWN');
        if (hasRouteFail) assignedCategoryLabels.push('ROUTE_FAIL');
        if (hasFtthDown) assignedCategoryLabels.push('FTTH_DOWN');
        if (hasOfcFail) assignedCategoryLabels.push('OFC_FAIL');
        if (hasEb) assignedCategoryLabels.push('EB');
        
        return {
          id: event.id,
          name: event.name,
          location: event.location,
          circle: event.circle,
          zone: event.zone,
          startDate: event.startDate,
          endDate: event.endDate,
          status: event.status,
          category: assignedCategoryLabels.join(','),
          myRole,
          isCreator,
          isManager,
          isTeamMember,
          hasDirectAssignment,
          assignmentId: assignment?.id ?? null,
          teamMembers,
          myTargets: {
            sim: mySimTarget,
            ftth: myFtthTarget,
            lease: myLeaseTarget,
            btsDown: myBtsDownTarget,
            routeFail: myRouteFailTarget,
            ftthDown: myFtthDownTarget,
            ofcFail: myOfcFailTarget,
            eb: myEbTarget,
          },
          myProgress: {
            simSold: assignment?.simSold ?? 0,
            ftthSold: assignment?.ftthSold ?? 0,
          },
          maintenanceProgress: {
            lease: event.leaseCompleted ?? 0,
            leaseTarget: event.targetLease ?? 0,
            btsDown: event.btsDownCompleted ?? 0,
            btsDownTarget: event.targetBtsDown ?? 0,
            routeFail: event.routeFailCompleted ?? 0,
            routeFailTarget: event.targetRouteFail ?? 0,
            ftthDown: event.ftthDownCompleted ?? 0,
            ftthDownTarget: event.targetFtthDown ?? 0,
            ofcFail: event.ofcFailCompleted ?? 0,
            ofcFailTarget: event.targetOfcFail ?? 0,
            eb: event.ebCompleted ?? 0,
            ebTarget: event.targetEb ?? 0,
          },
          categories: {
            hasSIM,
            hasFTTH,
            hasLease,
            hasBtsDown,
            hasRouteFail,
            hasFtthDown,
            hasOfcFail,
            hasEb,
          },
          submissionStatus: (() => {
            if (assignment?.submissionStatus && assignment.submissionStatus !== 'not_started') {
              return assignment.submissionStatus;
            }
            const hasProgress = 
              (assignment?.simSold ?? 0) > 0 || 
              (assignment?.ftthSold ?? 0) > 0 ||
              (event.leaseCompleted ?? 0) > 0 ||
              (event.btsDownCompleted ?? 0) > 0 ||
              (event.routeFailCompleted ?? 0) > 0 ||
              (event.ftthDownCompleted ?? 0) > 0 ||
              (event.ofcFailCompleted ?? 0) > 0 ||
              (event.ebCompleted ?? 0) > 0;
            return hasProgress ? 'in_progress' : 'not_started';
          })(),
          submittedAt: assignment?.submittedAt ?? null,
          reviewedAt: assignment?.reviewedAt ?? null,
          rejectionReason: assignment?.rejectionReason ?? null,
        };
      });
    }),

  submitMyProgress: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      eventId: z.string().uuid(),
      simSold: z.number().min(0).optional(),
      ftthSold: z.number().min(0).optional(),
      leaseCompleted: z.number().min(0).optional(),
      ebCompleted: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      
      const eventCheck = await db.select({ status: events.status }).from(events).where(eq(events.id, input.eventId));
      if (!eventCheck[0]) throw new Error("Event not found");
      if (eventCheck[0].status === 'completed' || eventCheck[0].status === 'cancelled') {
        throw new Error(`Cannot submit progress for ${eventCheck[0].status} task`);
      }
      
      const existingAssignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (existingAssignment[0]) {
        const assignedTypes = (existingAssignment[0].assignedTaskTypes as string[]) || [];
        const hasAssignedTypes = assignedTypes.length > 0;
        
        if (hasAssignedTypes) {
          if (input.simSold !== undefined && input.simSold > 0 && !assignedTypes.includes('SIM')) {
            throw new Error('You are not assigned to SIM tasks');
          }
          if (input.ftthSold !== undefined && input.ftthSold > 0 && !assignedTypes.includes('FTTH')) {
            throw new Error('You are not assigned to FTTH tasks');
          }
          if (input.leaseCompleted !== undefined && input.leaseCompleted > 0 && !assignedTypes.includes('LEASE_CIRCUIT')) {
            throw new Error('You are not assigned to Lease Circuit tasks');
          }
          if (input.ebCompleted !== undefined && input.ebCompleted > 0 && !assignedTypes.includes('EB')) {
            throw new Error('You are not assigned to EB tasks');
          }
        }
        
        if (input.simSold !== undefined && existingAssignment[0].simTarget > 0 && input.simSold > existingAssignment[0].simTarget) {
          throw new Error(`SIM sold (${input.simSold}) cannot exceed target (${existingAssignment[0].simTarget})`);
        }
        if (input.ftthSold !== undefined && existingAssignment[0].ftthTarget > 0 && input.ftthSold > existingAssignment[0].ftthTarget) {
          throw new Error(`FTTH sold (${input.ftthSold}) cannot exceed target (${existingAssignment[0].ftthTarget})`);
        }
        if (input.leaseCompleted !== undefined && existingAssignment[0].leaseTarget > 0 && input.leaseCompleted > existingAssignment[0].leaseTarget) {
          throw new Error(`Lease completed (${input.leaseCompleted}) cannot exceed target (${existingAssignment[0].leaseTarget})`);
        }
        if (input.ebCompleted !== undefined && existingAssignment[0].ebTarget > 0 && input.ebCompleted > existingAssignment[0].ebTarget) {
          throw new Error(`EB completed (${input.ebCompleted}) cannot exceed target (${existingAssignment[0].ebTarget})`);
        }
        
        const updateData: any = { updatedAt: new Date() };
        if (input.simSold !== undefined) updateData.simSold = input.simSold;
        if (input.ftthSold !== undefined) updateData.ftthSold = input.ftthSold;
        if (input.leaseCompleted !== undefined) updateData.leaseCompleted = input.leaseCompleted;
        if (input.ebCompleted !== undefined) updateData.ebCompleted = input.ebCompleted;
        
        await db.update(eventAssignments)
          .set(updateData)
          .where(eq(eventAssignments.id, existingAssignment[0].id));
        
        const simValue = input.simSold ?? existingAssignment[0].simSold ?? 0;
        const ftthValue = input.ftthSold ?? existingAssignment[0].ftthSold ?? 0;
        
        const existingSalesEntries = await db.select().from(eventSalesEntries)
          .where(and(
            eq(eventSalesEntries.eventId, input.eventId),
            eq(eventSalesEntries.employeeId, input.employeeId)
          ))
          .orderBy(desc(eventSalesEntries.createdAt));
        
        if (existingSalesEntries.length === 0 && (simValue > 0 || ftthValue > 0)) {
          await db.insert(eventSalesEntries).values({
            eventId: input.eventId,
            employeeId: input.employeeId,
            simsSold: simValue,
            ftthSold: ftthValue,
            simsActivated: 0,
            ftthActivated: 0,
            customerType: 'B2C',
            remarks: '__auto_generated__',
          });
        } else if (existingSalesEntries.length === 1 && existingSalesEntries[0].remarks === '__auto_generated__') {
          await db.update(eventSalesEntries)
            .set({
              simsSold: simValue,
              ftthSold: ftthValue,
            })
            .where(eq(eventSalesEntries.id, existingSalesEntries[0].id));
        }
        
        const progressDetails: Record<string, unknown> = {};
        if (input.simSold !== undefined) progressDetails.simSold = input.simSold;
        if (input.ftthSold !== undefined) progressDetails.ftthSold = input.ftthSold;
        if (input.leaseCompleted !== undefined) progressDetails.leaseCompleted = input.leaseCompleted;
        if (input.ebCompleted !== undefined) progressDetails.ebCompleted = input.ebCompleted;
        
        await db.insert(auditLogs).values({
          action: 'SUBMIT_TASK_PROGRESS',
          entityType: 'EVENT',
          entityId: input.eventId,
          performedBy: input.employeeId,
          timestamp: new Date(),
          details: progressDetails,
        });
        
        return { success: true, message: 'Progress updated successfully' };
      }
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]) {
        throw new Error('Employee not found');
      }
      
      const event = await db.select().from(events)
        .where(eq(events.id, input.eventId));
      
      if (!event[0]) {
        throw new Error('Event not found');
      }
      
      const employeePersNo = employee[0].persNo;
      const assignedTeam = (event[0].assignedTeam as string[]) || [];
      
      if (!employeePersNo || !assignedTeam.includes(employeePersNo)) {
        throw new Error('You are not assigned to this task');
      }
      
      await db.insert(eventAssignments).values({
        eventId: input.eventId,
        employeeId: input.employeeId,
        simTarget: 0,
        ftthTarget: 0,
        simSold: input.simSold || 0,
        ftthSold: input.ftthSold || 0,
        leaseCompleted: input.leaseCompleted || 0,
        ebCompleted: input.ebCompleted || 0,
        assignedBy: input.employeeId,
      });
      
      const simVal = input.simSold || 0;
      const ftthVal = input.ftthSold || 0;
      if (simVal > 0 || ftthVal > 0) {
        const existingEntry = await db.select().from(eventSalesEntries)
          .where(and(
            eq(eventSalesEntries.eventId, input.eventId),
            eq(eventSalesEntries.employeeId, input.employeeId)
          ))
          .limit(1);
        
        if (existingEntry.length === 0) {
          await db.insert(eventSalesEntries).values({
            eventId: input.eventId,
            employeeId: input.employeeId,
            simsSold: simVal,
            ftthSold: ftthVal,
            simsActivated: 0,
            ftthActivated: 0,
            customerType: 'B2C',
            remarks: '__auto_generated__',
          });
        }
      }
      
      const newProgressDetails: Record<string, unknown> = {};
      if (input.simSold) newProgressDetails.simSold = input.simSold;
      if (input.ftthSold) newProgressDetails.ftthSold = input.ftthSold;
      if (input.leaseCompleted) newProgressDetails.leaseCompleted = input.leaseCompleted;
      if (input.ebCompleted) newProgressDetails.ebCompleted = input.ebCompleted;
      
      await db.insert(auditLogs).values({
        action: 'SUBMIT_TASK_PROGRESS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.employeeId,
        timestamp: new Date(),
        details: newProgressDetails,
      });
      
      return { success: true, message: 'Progress submitted successfully' };
    }),

  submitTaskForReview: publicProcedure
    .input(z.object({
      assignmentId: z.string().uuid(),
      employeeId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const assignment = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.id, input.assignmentId));
      
      if (!assignment[0]) {
        throw new Error('Assignment not found');
      }
      
      if (assignment[0].employeeId !== input.employeeId) {
        throw new Error('You can only submit your own tasks');
      }
      
      await db.update(eventAssignments)
        .set({ 
          submissionStatus: 'submitted',
          submittedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(eventAssignments.id, input.assignmentId));
      
      // Send notification to task creator
      try {
        const event = await db.select().from(events)
          .where(eq(events.id, assignment[0].eventId));
        const submitter = await db.select().from(employees)
          .where(eq(employees.id, input.employeeId));
        
        if (event[0] && submitter[0]) {
          await notifyTaskSubmitted(
            event[0].createdBy,
            event[0].id,
            event[0].name,
            submitter[0].name
          );
        }
      } catch (notifError) {
        console.error("Failed to send submission notification:", notifError);
      }
      
      return { success: true, message: 'Task submitted for review' };
    }),

  approveTask: publicProcedure
    .input(z.object({
      assignmentId: z.string().uuid(),
      reviewerId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const assignment = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.id, input.assignmentId));
      
      if (!assignment[0]) {
        throw new Error('Assignment not found');
      }
      
      const event = await db.select().from(events)
        .where(eq(events.id, assignment[0].eventId));
      
      if (!event[0] || event[0].createdBy !== input.reviewerId) {
        const assignedBy = assignment[0].assignedBy;
        if (assignedBy !== input.reviewerId) {
          throw new Error('Only the task creator or assigner can approve');
        }
      }
      
      await db.update(eventAssignments)
        .set({ 
          submissionStatus: 'approved',
          reviewedAt: new Date(),
          reviewedBy: input.reviewerId,
          updatedAt: new Date()
        })
        .where(eq(eventAssignments.id, input.assignmentId));
      
      // Send notification to team member
      try {
        const reviewer = await db.select().from(employees)
          .where(eq(employees.id, input.reviewerId));
        
        if (event[0] && reviewer[0]) {
          await notifyTaskApproved(
            assignment[0].employeeId,
            event[0].id,
            event[0].name,
            reviewer[0].name
          );
        }
      } catch (notifError) {
        console.error("Failed to send approval notification:", notifError);
      }
      
      return { success: true, message: 'Task approved' };
    }),

  rejectTask: publicProcedure
    .input(z.object({
      assignmentId: z.string().uuid(),
      reviewerId: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      
      const assignment = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.id, input.assignmentId));
      
      if (!assignment[0]) {
        throw new Error('Assignment not found');
      }
      
      const event = await db.select().from(events)
        .where(eq(events.id, assignment[0].eventId));
      
      if (!event[0] || event[0].createdBy !== input.reviewerId) {
        const assignedBy = assignment[0].assignedBy;
        if (assignedBy !== input.reviewerId) {
          throw new Error('Only the task creator or assigner can reject');
        }
      }
      
      await db.update(eventAssignments)
        .set({ 
          submissionStatus: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: input.reviewerId,
          rejectionReason: input.reason || null,
          updatedAt: new Date()
        })
        .where(eq(eventAssignments.id, input.assignmentId));
      
      // Send notification to team member
      try {
        const reviewer = await db.select().from(employees)
          .where(eq(employees.id, input.reviewerId));
        
        if (event[0] && reviewer[0]) {
          await notifyTaskRejected(
            assignment[0].employeeId,
            event[0].id,
            event[0].name,
            reviewer[0].name,
            input.reason
          );
        }
      } catch (notifError) {
        console.error("Failed to send rejection notification:", notifError);
      }
      
      return { success: true, message: 'Task rejected' };
    }),

  getSalesEntrySummary: publicProcedure
    .input(z.object({
      eventIds: z.array(z.string().uuid()),
    }))
    .query(async ({ input }) => {
      if (input.eventIds.length === 0) {
        return { totalSimsActivated: 0, totalFtthActivated: 0 };
      }
      const result = await db.select({
        totalSimsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        totalFtthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
      }).from(eventSalesEntries)
        .where(inArray(eventSalesEntries.eventId, input.eventIds));
      return {
        totalSimsActivated: Number(result[0]?.totalSimsActivated || 0),
        totalFtthActivated: Number(result[0]?.totalFtthActivated || 0),
      };
    }),
});
