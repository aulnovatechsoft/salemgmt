import { z } from "zod";
import { eq, and, desc, gte, lte, sql, or, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, events, employees, auditLogs, eventAssignments, eventSalesEntries, eventSubtasks, employeeMaster, resources, resourceAllocations } from "@/backend/db";
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

async function getAllSubordinateIds(employeeId: string, maxDepth: number = 10): Promise<string[]> {
  const employee = await db.select({ persNo: employees.persNo }).from(employees)
    .where(eq(employees.id, employeeId));
  
  if (!employee[0]?.persNo) {
    return [];
  }
  
  const allSubordinateIds: string[] = [];
  const persNosToProcess: string[] = [employee[0].persNo];
  const processedPersNos = new Set<string>();
  let depth = 0;
  
  while (persNosToProcess.length > 0 && depth < maxDepth) {
    const currentBatch = [...persNosToProcess];
    persNosToProcess.length = 0;
    
    for (const persNo of currentBatch) {
      if (processedPersNos.has(persNo)) continue;
      processedPersNos.add(persNo);
      
      const subordinates = await db.select({
        persNo: employeeMaster.persNo,
        linkedEmployeeId: employeeMaster.linkedEmployeeId,
      }).from(employeeMaster)
        .where(eq(employeeMaster.reportingPersNo, persNo));
      
      for (const sub of subordinates) {
        if (sub.linkedEmployeeId) {
          allSubordinateIds.push(sub.linkedEmployeeId);
        }
        if (sub.persNo && !processedPersNos.has(sub.persNo)) {
          persNosToProcess.push(sub.persNo);
        }
      }
    }
    depth++;
  }
  
  return [...new Set(allSubordinateIds)];
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

async function autoCompleteExpiredEvents(eventsList: typeof events.$inferSelect[]) {
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
      console.log("Fetching all events", input);
      const results = await db.select().from(events).orderBy(desc(events.createdAt));
      
      // Get all event assignments to calculate sales progress
      const allAssignments = await db.select().from(eventAssignments);
      
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
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
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
      console.log("Fetching my events for employee:", input.employeeId);
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]) {
        return [];
      }
      
      // Admin users can see all tasks across all circles
      if (employee[0].role === 'ADMIN') {
        console.log("Admin user - returning all events");
        const allEvents = await db.select().from(events)
          .orderBy(desc(events.createdAt));
        return allEvents;
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
      
      const [allDraftEvents, circleGMMap, managerHierarchyMap] = await Promise.all([
        db.select().from(events)
          .where(eq(events.status, 'draft'))
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
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
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
          teamMembers,
          creatorName: creatorInfo?.name || null,
          assigneeName: assigneeInfo?.name || null,
          assigneeDesignation: assigneeInfo?.designation || null,
        };
      });
      
      console.log(`Returning ${eventsWithProgress.length} events for employee ${input.employeeId}`);
      return eventsWithProgress;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching event by id:", input.id);
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
      console.log("Creating event:", input.name);
      
      // Server-side role validation: ADMIN cannot create events
      const creator = await db.select().from(employees).where(eq(employees.id, input.createdBy)).limit(1);
      if (creator[0]?.role === 'ADMIN') {
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
        category: input.category,
        targetSim: input.targetSim,
        targetFtth: input.targetFtth,
        targetEb: input.targetEb || 0,
        targetLease: input.targetLease || 0,
        targetBtsDown: input.targetBtsDown || 0,
        targetFtthDown: input.targetFtthDown || 0,
        targetRouteFail: input.targetRouteFail || 0,
        targetOfcFail: input.targetOfcFail || 0,
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
          
          console.log("Processing team assignments:", assignments.length);
          
          for (const assignment of assignments) {
            const hasSim = assignment.taskIds.includes('SIM');
            const hasFtth = assignment.taskIds.includes('FTTH');
            
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
              
              if (!existingAssignment[0]) {
                await db.insert(eventAssignments).values({
                  eventId: result[0].id,
                  employeeId: employeeId,
                  simTarget: simTarget,
                  ftthTarget: ftthTarget,
                  assignedBy: input.createdBy,
                });
              } else {
                await db.update(eventAssignments)
                  .set({ simTarget, ftthTarget, updatedAt: new Date() })
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
      console.log("Updating event:", input.id);
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
      console.log("Deleting event:", input.id);
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
      console.log("Fetching events by circle:", input.circle);
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
      console.log("Fetching active events");
      
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
      console.log("Fetching upcoming events");
      
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
      console.log("Assigning team to event:", input.eventId);
      
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
      console.log("Fetching event with details - Input ID:", input.id);
      
      if (!input.id || input.id.trim() === '') {
        console.error("getEventWithDetails: Empty ID provided");
        throw new Error("Event ID is required");
      }
      
      try {
        const eventResult = await db.select().from(events).where(eq(events.id, input.id));
        console.log("Event query result:", eventResult.length > 0 ? "Found" : "Not found");
        
        if (!eventResult[0]) {
          console.log("No event found with ID:", input.id);
          return null;
        }
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.id));
      
      const salesEntries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.id))
        .orderBy(desc(eventSalesEntries.createdAt));
      
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
        const totalSimsSold = memberSales.reduce((sum, s) => sum + s.simsSold, 0);
        const totalFtthSold = memberSales.reduce((sum, s) => sum + s.ftthSold, 0);
        
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
          salesEntries: memberSales,
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
              salesEntries: [],
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
          subtasks: subtasksWithAssignees,
          slaStatus,
          summary: {
            totalSimsSold,
            totalFtthSold,
            totalEntries: salesEntries.length,
            teamCount: assignments.length,
            subtaskStats,
          },
        };
        
        console.log("Returning event details for:", result.name);
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
      const totalSimSold = assignments.reduce((sum, a) => sum + a.simSold, 0);
      const totalFtthSold = assignments.reduce((sum, a) => sum + a.ftthSold, 0);
      
      return {
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
          simToDistribute: event[0].allocatedSim - totalSimDistributed,
          ftthToDistribute: event[0].allocatedFtth - totalFtthDistributed,
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
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Assigning team member with targets:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const existing = allAssignments.find(a => a.employeeId === input.employeeId);
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== input.employeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      
      const newTotalSim = currentSimDistributed + input.simTarget;
      const newTotalFtth = currentFtthDistributed + input.ftthTarget;
      
      if (newTotalSim > event[0].allocatedSim) {
        const available = event[0].allocatedSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
      }
      
      if (newTotalFtth > event[0].allocatedFtth) {
        const available = event[0].allocatedFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
      }
      
      if (existing) {
        await db.update(eventAssignments)
          .set({
            simTarget: input.simTarget,
            ftthTarget: input.ftthTarget,
            updatedAt: new Date(),
          })
          .where(eq(eventAssignments.id, existing.id));
      } else {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: input.employeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
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
        details: { employeeId: input.employeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget },
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
            console.log("Assignment notification sent to:", input.employeeId);
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
      console.log("Removing team member:", input);
      
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
      console.log("Submitting event sales:", input);
      
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
      
      const newTotalSim = assignment[0].simSold + input.simsSold;
      const newTotalFtth = assignment[0].ftthSold + input.ftthSold;
      
      if (newTotalSim > assignment[0].simTarget) {
        const remaining = assignment[0].simTarget - assignment[0].simSold;
        throw new Error(`Cannot sell ${input.simsSold} SIMs. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      if (newTotalFtth > assignment[0].ftthTarget) {
        const remaining = assignment[0].ftthTarget - assignment[0].ftthSold;
        throw new Error(`Cannot sell ${input.ftthSold} FTTH. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      const result = await db.insert(eventSalesEntries).values({
        eventId: input.eventId,
        employeeId: input.employeeId,
        simsSold: input.simsSold,
        simsActivated: input.simsActivated,
        ftthSold: input.ftthSold,
        ftthActivated: input.ftthActivated,
        customerType: input.customerType,
        photos: input.photos || [],
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        remarks: input.remarks,
      }).returning();
      
      await db.update(eventAssignments)
        .set({
          simSold: newTotalSim,
          ftthSold: newTotalFtth,
          updatedAt: new Date(),
        })
        .where(eq(eventAssignments.id, assignment[0].id));
      
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
        details: { eventId: input.eventId, simsSold: input.simsSold, ftthSold: input.ftthSold },
      });

      return result[0];
    }),

  getEventSalesEntries: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching event sales entries:", input.eventId);
      const entries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.eventId))
        .orderBy(desc(eventSalesEntries.createdAt));
      return entries;
    }),

  getMyAssignedEvents: publicProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching assigned events for employee:", input.employeeId);
      
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
      console.log("Fetching available team members for circle:", input.circle, "manager:", input.managerPurseId);
      
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
        console.log("Direct reports of", input.managerPurseId, ":", directReportPurseIds.length);
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
      console.log("Updating event status:", input);
      
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
      console.log("Updating task progress:", input);
      
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
      console.log("Updating member task progress:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      console.log("Found event:", event[0] ? event[0].name : "NOT FOUND");
      if (!event[0]) throw new Error("Event not found");
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      console.log("Found assignment:", assignment[0] ? "YES" : "NOT FOUND");
      if (!assignment[0]) throw new Error("Team member assignment not found");
      
      console.log("Assignment data:", JSON.stringify(assignment[0]));
      
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
      
      const currentMemberCompleted = (assignment[0] as any)[completedColumn] || 0;
      let memberTarget = (assignment[0] as any)[targetColumn] || 0;
      
      // If member has no individual target, use distributed target from event level
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
        
        // Get all assignments to calculate distributed target
        const allAssignmentsForDistribution = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        const teamSize = allAssignmentsForDistribution.length;
        const memberIdx = allAssignmentsForDistribution.findIndex(a => a.employeeId === input.employeeId);
        
        if (teamSize > 0) {
          const baseTarget = Math.floor(eventTarget / teamSize);
          const remainder = eventTarget % teamSize;
          memberTarget = baseTarget + (memberIdx < remainder ? 1 : 0);
        }
        console.log(`Using distributed target: ${memberTarget} (event target: ${eventTarget}, team size: ${teamSize})`);
      }
      
      console.log(`Task type: ${input.taskType}, Current: ${currentMemberCompleted}, Target: ${memberTarget}`);
      
      let newMemberCompleted = currentMemberCompleted + input.increment;
      newMemberCompleted = Math.max(0, Math.min(newMemberCompleted, memberTarget));
      
      console.log(`New completed value: ${newMemberCompleted}`);
      
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
      console.log("Creating subtask:", input);
      
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
      console.log("Updating subtask:", input);
      
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
      console.log("Deleting subtask:", input.subtaskId);
      
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
      employeeId: z.string(), // Can be UUID or persNo
      simTarget: z.number().min(0),
      ftthTarget: z.number().min(0),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating team member targets:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      // Check if employeeId is a UUID or persNo
      const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.employeeId);
      
      let actualEmployeeId = input.employeeId;
      
      // If it's a persNo, look up the linked employee
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
      
      // If no assignment exists, create one (upsert behavior)
      if (!currentAssignment) {
        // Validate targets against event allocation
        const otherAssignments = allAssignments;
        const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
        const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
        
        const newTotalSim = currentSimDistributed + input.simTarget;
        const newTotalFtth = currentFtthDistributed + input.ftthTarget;
        
        if (newTotalSim > event[0].allocatedSim) {
          const available = event[0].allocatedSim - currentSimDistributed;
          throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
        }
        
        if (newTotalFtth > event[0].allocatedFtth) {
          const available = event[0].allocatedFtth - currentFtthDistributed;
          throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
        }
        
        // Create new assignment
        const newAssignment = await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: actualEmployeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          assignedBy: input.updatedBy,
        }).returning();
        
        await db.insert(auditLogs).values({
          action: 'CREATE_TEAM_TARGETS',
          entityType: 'EVENT',
          entityId: input.eventId,
          performedBy: input.updatedBy,
          details: { employeeId: actualEmployeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget },
        });
        
        return newAssignment[0];
      }
      
      if (input.simTarget < currentAssignment.simSold) {
        throw new Error(`Cannot set SIM target below already sold amount (${currentAssignment.simSold})`);
      }
      if (input.ftthTarget < currentAssignment.ftthSold) {
        throw new Error(`Cannot set FTTH target below already sold amount (${currentAssignment.ftthSold})`);
      }
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== actualEmployeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      
      const newTotalSim = currentSimDistributed + input.simTarget;
      const newTotalFtth = currentFtthDistributed + input.ftthTarget;
      
      if (newTotalSim > event[0].allocatedSim) {
        const available = event[0].allocatedSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
      }
      
      if (newTotalFtth > event[0].allocatedFtth) {
        const available = event[0].allocatedFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
      }
      
      const result = await db.update(eventAssignments)
        .set({
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
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
        details: { employeeId: actualEmployeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget },
      });

      return result[0];
    }),

  getCircleResourceDashboard: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching circle resource dashboard:", input.circle);
      
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
      
      const eventSummaries = circleEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
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
          simSold: allAssignments.reduce((sum, a) => sum + a.simSold, 0),
          ftthSold: allAssignments.reduce((sum, a) => sum + a.ftthSold, 0),
        },
      };
    }),

  getHierarchicalReport: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching hierarchical report for employee:", input.employeeId);
      
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
      
      const allEvents = [...createdEvents, ...managedEvents.filter(e => !createdEvents.find(c => c.id === e.id))];
      
      const eventReports = allEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
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
      console.log("=== FETCHING MY ASSIGNED TASKS ===");
      console.log("Employee ID:", input.employeeId);
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]) {
        console.log("Employee not found, returning empty");
        return [];
      }
      
      const employeePersNo = employee[0].persNo;
      console.log("Employee persNo:", employeePersNo);
      
      // Get events where employee has direct assignment in event_assignments table
      const myAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.employeeId, input.employeeId));
      console.log("Direct assignments count:", myAssignments.length);
      
      const assignedEventIds = myAssignments.map(a => a.eventId);
      console.log("Direct assignment event IDs:", assignedEventIds);
      
      // Get events where employee is in assignedTeam array (by persNo)
      let teamEventIds: string[] = [];
      if (employeePersNo) {
        const eventsWithPersNoAssignment = await db.select({ id: events.id })
          .from(events)
          .where(sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem = ${employeePersNo})`);
        teamEventIds = eventsWithPersNoAssignment.map(e => e.id);
        console.log("Events from assignedTeam (persNo match):", teamEventIds.length);
      }
      
      // Get events where employee is the assigned manager (assignedTo)
      const managerEvents = await db.select({ id: events.id })
        .from(events)
        .where(eq(events.assignedTo, input.employeeId));
      const managerEventIds = managerEvents.map(e => e.id);
      console.log("Events as manager (assignedTo):", managerEventIds.length);
      
      // Get events where employee is the creator
      const creatorEvents = await db.select({ id: events.id })
        .from(events)
        .where(eq(events.createdBy, input.employeeId));
      const creatorEventIds = creatorEvents.map(e => e.id);
      console.log("Events as creator:", creatorEventIds.length);
      
      // Combine all event IDs (deduplicated)
      const allEventIds = [...new Set([...assignedEventIds, ...teamEventIds, ...managerEventIds, ...creatorEventIds])];
      console.log("Total unique event IDs:", allEventIds.length);
      
      if (allEventIds.length === 0) {
        console.log("No events found for this employee's tasks");
        return [];
      }
      
      const myEvents = await db.select().from(events)
        .where(and(
          inArray(events.id, allEventIds),
          sql`${events.status} != 'draft'`
        ))
        .orderBy(desc(events.createdAt));
      
      const assignmentMap = new Map(myAssignments.map(a => [a.eventId, a]));
      
      return myEvents.map(event => {
        const assignment = assignmentMap.get(event.id);
        const categories = (event.category || '').split(',').filter(Boolean);
        const hasSIM = categories.includes('SIM');
        const hasFTTH = categories.includes('FTTH');
        const hasLease = categories.includes('LEASE_CIRCUIT');
        const hasBtsDown = categories.includes('BTS_DOWN');
        const hasRouteFail = categories.includes('ROUTE_FAIL');
        const hasFtthDown = categories.includes('FTTH_DOWN');
        const hasOfcFail = categories.includes('OFC_FAIL');
        const hasEb = categories.includes('EB');
        
        const teamSize = (event.assignedTeam as string[] || []).length || 1;
        const teamIndex = employeePersNo ? (event.assignedTeam as string[] || []).indexOf(employeePersNo) : 0;
        const effectiveIndex = teamIndex >= 0 ? teamIndex : 0;
        
        const getDistributedTarget = (total: number) => {
          const base = Math.floor(total / teamSize);
          const remainder = total % teamSize;
          return effectiveIndex < remainder ? base + 1 : base;
        };
        
        // Determine employee's role in this task
        const isCreator = event.createdBy === input.employeeId;
        const isManager = event.assignedTo === input.employeeId;
        const isTeamMember = employeePersNo ? (event.assignedTeam as string[] || []).includes(employeePersNo) : false;
        const hasDirectAssignment = !!assignment;
        
        let myRole: 'creator' | 'manager' | 'team_member' | 'assigned' = 'team_member';
        if (isCreator) myRole = 'creator';
        else if (isManager) myRole = 'manager';
        else if (hasDirectAssignment) myRole = 'assigned';
        
        return {
          id: event.id,
          name: event.name,
          location: event.location,
          circle: event.circle,
          zone: event.zone,
          startDate: event.startDate,
          endDate: event.endDate,
          status: event.status,
          category: event.category,
          myRole,
          isCreator,
          isManager,
          isTeamMember,
          hasDirectAssignment,
          assignmentId: assignment?.id || null,
          myTargets: {
            sim: assignment?.simTarget || (hasSIM ? getDistributedTarget(event.targetSim) : 0),
            ftth: assignment?.ftthTarget || (hasFTTH ? getDistributedTarget(event.targetFtth) : 0),
            lease: hasLease ? getDistributedTarget(event.targetLease || 0) : 0,
            btsDown: hasBtsDown ? getDistributedTarget(event.targetBtsDown || 0) : 0,
            routeFail: hasRouteFail ? getDistributedTarget(event.targetRouteFail || 0) : 0,
            ftthDown: hasFtthDown ? getDistributedTarget(event.targetFtthDown || 0) : 0,
            ofcFail: hasOfcFail ? getDistributedTarget(event.targetOfcFail || 0) : 0,
            eb: hasEb ? getDistributedTarget(event.targetEb || 0) : 0,
          },
          myProgress: {
            simSold: assignment?.simSold || 0,
            ftthSold: assignment?.ftthSold || 0,
          },
          maintenanceProgress: {
            lease: event.leaseCompleted || 0,
            leaseTarget: event.targetLease || 0,
            btsDown: event.btsDownCompleted || 0,
            btsDownTarget: event.targetBtsDown || 0,
            routeFail: event.routeFailCompleted || 0,
            routeFailTarget: event.targetRouteFail || 0,
            ftthDown: event.ftthDownCompleted || 0,
            ftthDownTarget: event.targetFtthDown || 0,
            ofcFail: event.ofcFailCompleted || 0,
            ofcFailTarget: event.targetOfcFail || 0,
            eb: event.ebCompleted || 0,
            ebTarget: event.targetEb || 0,
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
            // If already has a submission status, use it
            if (assignment?.submissionStatus && assignment.submissionStatus !== 'not_started') {
              return assignment.submissionStatus;
            }
            // Calculate effective status based on actual progress
            const hasProgress = 
              (assignment?.simSold || 0) > 0 || 
              (assignment?.ftthSold || 0) > 0 ||
              (event.leaseCompleted || 0) > 0 ||
              (event.btsDownCompleted || 0) > 0 ||
              (event.routeFailCompleted || 0) > 0 ||
              (event.ftthDownCompleted || 0) > 0 ||
              (event.ofcFailCompleted || 0) > 0 ||
              (event.ebCompleted || 0) > 0;
            return hasProgress ? 'in_progress' : 'not_started';
          })(),
          submittedAt: assignment?.submittedAt || null,
          reviewedAt: assignment?.reviewedAt || null,
          rejectionReason: assignment?.rejectionReason || null,
        };
      });
    }),

  submitMyProgress: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      eventId: z.string().uuid(),
      simSold: z.number().min(0).optional(),
      ftthSold: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Submitting progress:", input);
      
      const existingAssignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (existingAssignment[0]) {
        const updateData: any = { updatedAt: new Date() };
        if (input.simSold !== undefined) updateData.simSold = input.simSold;
        if (input.ftthSold !== undefined) updateData.ftthSold = input.ftthSold;
        
        await db.update(eventAssignments)
          .set(updateData)
          .where(eq(eventAssignments.id, existingAssignment[0].id));
        
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
        assignedBy: input.employeeId,
      });
      
      return { success: true, message: 'Progress submitted successfully' };
    }),

  submitTaskForReview: publicProcedure
    .input(z.object({
      assignmentId: z.string().uuid(),
      employeeId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Submitting task for review:", input);
      
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
          console.log("Notification sent to task creator:", event[0].createdBy);
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
      console.log("Approving task:", input);
      
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
          console.log("Approval notification sent to:", assignment[0].employeeId);
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
      console.log("Rejecting task:", input);
      
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
          console.log("Rejection notification sent to:", assignment[0].employeeId);
        }
      } catch (notifError) {
        console.error("Failed to send rejection notification:", notifError);
      }
      
      return { success: true, message: 'Task rejected' };
    }),
});
