import { z } from "zod";
import { eq, and, desc, gte, lte, sql, or, inArray, isNotNull } from "drizzle-orm";
import { createTRPCRouter, publicProcedure, authedProcedure } from "../create-context";

const GEO_FENCE_KM = Number(process.env.GEO_FENCE_KM ?? '50');
const GEO_FENCE_HARD_MULT = 3;
const GEO_FENCE_ENFORCE = (process.env.GEO_FENCE_ENFORCE ?? 'soft').toLowerCase();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Fair integer distribution: split `total` across `count` recipients so the
 * shares sum exactly to `total`. The first `total % count` recipients get
 * `floor(total/count) + 1`; the rest get `floor(total/count)`.
 *
 * Examples:
 *   distributeFairly(10, 3)  -> [4, 3, 3]      (sum 10)
 *   distributeFairly(10, 4)  -> [3, 3, 2, 2]   (sum 10)
 *   distributeFairly(7, 4)   -> [2, 2, 2, 1]   (sum 7)
 *   distributeFairly(0, 5)   -> [0, 0, 0, 0, 0]
 *   distributeFairly(5, 0)   -> []  (caller must guard)
 *
 * Negative or non-integer totals are clamped to a non-negative integer.
 */
function distributeFairly(total: number, count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const safeTotal = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const base = Math.floor(safeTotal / count);
  const remainder = safeTotal % count;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = i < remainder ? base + 1 : base;
  return out;
}
import { db, events, employees, auditLogs, eventAssignments, eventSalesEntries, eventSubtasks, employeeMaster, resources, resourceAllocations, financeCollectionEntries, notifications, maintenanceEntries, simSaleLines, ftthSaleLines, lcSaleLines, ebSaleLines } from "@/backend/db";
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
    return [];
  }
  lastAutoCompleteRun = now;

  const today = getISTDate();
  today.setHours(0, 0, 0, 0);
  
  const expiredCandidateIds: string[] = [];
  for (const event of eventsList) {
    if (event.status === 'active' && event.endDate) {
      const endDate = new Date(event.endDate);
      endDate.setHours(23, 59, 59, 999);
      if (endDate < today) {
        expiredCandidateIds.push(event.id);
      }
    }
  }
  
  if (expiredCandidateIds.length === 0) return [];
  
  const [salesProgress, assignProgress] = await Promise.all([
    db.select({
      eventId: eventSalesEntries.eventId,
      sim: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
      ftth: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
      lease: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
      eb: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
    }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, expiredCandidateIds)).groupBy(eventSalesEntries.eventId),
    db.select({
      eventId: eventAssignments.eventId,
      sim: sql<number>`COALESCE(SUM(${eventAssignments.simSold}), 0)::integer`,
      ftth: sql<number>`COALESCE(SUM(${eventAssignments.ftthSold}), 0)::integer`,
      lease: sql<number>`COALESCE(SUM(${eventAssignments.leaseCompleted}), 0)::integer`,
      eb: sql<number>`COALESCE(SUM(${eventAssignments.ebCompleted}), 0)::integer`,
      btsDown: sql<number>`COALESCE(SUM(${eventAssignments.btsDownCompleted}), 0)::integer`,
      routeFail: sql<number>`COALESCE(SUM(${eventAssignments.routeFailCompleted}), 0)::integer`,
      ftthDown: sql<number>`COALESCE(SUM(${eventAssignments.ftthDownCompleted}), 0)::integer`,
      ofcFail: sql<number>`COALESCE(SUM(${eventAssignments.ofcFailCompleted}), 0)::integer`,
    }).from(eventAssignments).where(inArray(eventAssignments.eventId, expiredCandidateIds)).groupBy(eventAssignments.eventId),
  ]);
  
  const progressByEvent = new Map<string, Record<string, number>>();
  for (const r of salesProgress) {
    progressByEvent.set(r.eventId, {
      sim: Number(r.sim), ftth: Number(r.ftth), lease: Number(r.lease), eb: Number(r.eb),
      btsDown: 0, routeFail: 0, ftthDown: 0, ofcFail: 0,
    });
  }
  for (const r of assignProgress) {
    const cur = progressByEvent.get(r.eventId) || { sim: 0, ftth: 0, lease: 0, eb: 0, btsDown: 0, routeFail: 0, ftthDown: 0, ofcFail: 0 };
    cur.sim = Math.max(cur.sim, Number(r.sim));
    cur.ftth = Math.max(cur.ftth, Number(r.ftth));
    cur.lease = Math.max(cur.lease, Number(r.lease));
    cur.eb = Math.max(cur.eb, Number(r.eb));
    cur.btsDown = Number(r.btsDown);
    cur.routeFail = Number(r.routeFail);
    cur.ftthDown = Number(r.ftthDown);
    cur.ofcFail = Number(r.ofcFail);
    progressByEvent.set(r.eventId, cur);
  }
  
  const eventsById = new Map(eventsList.map(e => [e.id, e]));
  const toComplete: string[] = [];
  for (const id of expiredCandidateIds) {
    const ev = eventsById.get(id);
    if (!ev) continue;
    const p = progressByEvent.get(id) || { sim: 0, ftth: 0, lease: 0, eb: 0, btsDown: 0, routeFail: 0, ftthDown: 0, ofcFail: 0 };
    const checks: { target: number; progress: number }[] = [
      { target: ev.targetSim ?? 0, progress: p.sim },
      { target: ev.targetFtth ?? 0, progress: p.ftth },
      { target: ev.targetLease ?? 0, progress: p.lease },
      { target: ev.targetEb ?? 0, progress: p.eb },
      { target: ev.targetBtsDown ?? 0, progress: p.btsDown },
      { target: ev.targetRouteFail ?? 0, progress: p.routeFail },
      { target: ev.targetFtthDown ?? 0, progress: p.ftthDown },
      { target: ev.targetOfcFail ?? 0, progress: p.ofcFail },
    ];
    const activeCategories = checks.filter(c => c.target > 0);
    if (activeCategories.length === 0) continue;
    const allMet = activeCategories.every(c => c.progress >= c.target);
    if (allMet) toComplete.push(id);
  }
  
  if (toComplete.length > 0) {
    await Promise.all(toComplete.map(id =>
      db.update(events)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(events.id, id))
    ));
    console.log(`Auto-completed ${toComplete.length} expired works with all targets met`);
  }
  
  return toComplete;
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
        
        const adminEventIds = allEvents.map(e => e.id);
        const adminAssignments = adminEventIds.length > 0 
          ? await db.select().from(eventAssignments).where(inArray(eventAssignments.eventId, adminEventIds))
          : [];
        const adminAssignsByEvent = new Map<string, typeof adminAssignments>();
        for (const a of adminAssignments) {
          const arr = adminAssignsByEvent.get(a.eventId) || [];
          arr.push(a);
          adminAssignsByEvent.set(a.eventId, arr);
        }
        
        const [adminSalesEntries, adminPerEmpSales] = adminEventIds.length > 0
          ? await Promise.all([
              db.select({
                eventId: eventSalesEntries.eventId,
                totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
                totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
              }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, adminEventIds)).groupBy(eventSalesEntries.eventId),
              db.select({
                eventId: eventSalesEntries.eventId,
                employeeId: eventSalesEntries.employeeId,
                simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
                ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
                leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
                ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
              }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, adminEventIds))
                .groupBy(eventSalesEntries.eventId, eventSalesEntries.employeeId),
            ])
          : [[], []];
        const adminSalesMap = new Map(adminSalesEntries.map(s => [s.eventId, s]));
        const adminPerEmpSalesMap = new Map<string, typeof adminPerEmpSales[0]>();
        for (const s of adminPerEmpSales) {
          adminPerEmpSalesMap.set(`${s.eventId}:${s.employeeId}`, s);
        }
        
        const adminTeamPersNos = [...new Set(allEvents.flatMap(e => (e.assignedTeam || []) as string[]))];
        let adminMasterMap = new Map<string, { persNo: string; name: string; designation: string | null }>();
        let adminPersNoToEmpId = new Map<string, string>();
        if (adminTeamPersNos.length > 0) {
          const empRows = await db.select({ id: employees.id, persNo: employees.persNo, name: employees.name, designation: employees.designation })
            .from(employees).where(inArray(employees.persNo, adminTeamPersNos));
          for (const row of empRows) {
            if (row.persNo) {
              adminPersNoToEmpId.set(row.persNo, row.id);
              adminMasterMap.set(row.persNo, { persNo: row.persNo, name: row.name, designation: row.designation || null });
            }
          }
          const missing = adminTeamPersNos.filter(p => !adminMasterMap.has(p));
          if (missing.length > 0) {
            const masterRecs = await db.select({ persNo: employeeMaster.persNo, name: employeeMaster.name, designation: employeeMaster.designation })
              .from(employeeMaster).where(inArray(employeeMaster.persNo, missing));
            for (const m of masterRecs) adminMasterMap.set(m.persNo, m);
          }
        }
        
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
          
          const evtAssigns = adminAssignsByEvent.get(event.id) || [];
          const assignByEmpId = new Map<string, typeof evtAssigns[0]>();
          for (const ea of evtAssigns) assignByEmpId.set(ea.employeeId, ea);
          
          const sales = adminSalesMap.get(event.id);
          const cats = (event.category || '').split(',').filter(Boolean);
          
          const teamMembers = eventTeam.map((persNo, idx) => {
            const member = adminMasterMap.get(persNo);
            const empId = adminPersNoToEmpId.get(persNo);
            const ma = empId ? assignByEmpId.get(empId) : undefined;
            const es = empId ? adminPerEmpSalesMap.get(`${event.id}:${empId}`) : undefined;
            const sz = eventTeam.length || 1;
            const dist = (total: number) => { const b = Math.floor(total / sz); return idx < (total % sz) ? b + 1 : b; };
            return {
              persNo,
              name: member?.name || persNo,
              designation: member?.designation || null,
              targets: {
                sim: ma ? ma.simTarget : (cats.includes('SIM') ? dist(event.targetSim) : 0),
                ftth: ma ? ma.ftthTarget : (cats.includes('FTTH') ? dist(event.targetFtth) : 0),
                lease: ma ? ma.leaseTarget : (cats.includes('LEASE_CIRCUIT') ? dist(event.targetLease ?? 0) : 0),
                btsDown: ma ? ma.btsDownTarget : (cats.includes('BTS_DOWN') ? dist(event.targetBtsDown ?? 0) : 0),
                routeFail: ma ? ma.routeFailTarget : (cats.includes('ROUTE_FAIL') ? dist(event.targetRouteFail ?? 0) : 0),
                ftthDown: ma ? ma.ftthDownTarget : (cats.includes('FTTH_DOWN') ? dist(event.targetFtthDown ?? 0) : 0),
                ofcFail: ma ? ma.ofcFailTarget : (cats.includes('OFC_FAIL') ? dist(event.targetOfcFail ?? 0) : 0),
                eb: ma ? ma.ebTarget : (cats.includes('EB') ? dist(event.targetEb ?? 0) : 0),
              },
              progress: {
                simSold: Math.max(es ? Number(es.simsSold) : 0, ma?.simSold ?? 0),
                ftthSold: Math.max(es ? Number(es.ftthSold) : 0, ma?.ftthSold ?? 0),
                lease: Math.max(es ? Number(es.leaseSold) : 0, ma?.leaseCompleted ?? 0),
                btsDown: ma?.btsDownCompleted ?? 0,
                routeFail: ma?.routeFailCompleted ?? 0,
                ftthDown: ma?.ftthDownCompleted ?? 0,
                ofcFail: ma?.ofcFailCompleted ?? 0,
                eb: Math.max(es ? Number(es.ebSold) : 0, ma?.ebCompleted ?? 0),
              },
            };
          });
          
          return { ...event, ownershipCategory, simSold: Number(sales?.totalSimsSold || 0), ftthSold: Number(sales?.totalFtthSold || 0), submissionStatus: 'not_started', teamMembers, creatorName: null, assigneeName: null, assigneeDesignation: null, myAssignment: null };
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
      
      const assignmentsByEventId = new Map<string, typeof relevantAssignments>();
      for (const a of relevantAssignments) {
        const arr = assignmentsByEventId.get(a.eventId) || [];
        arr.push(a);
        assignmentsByEventId.set(a.eventId, arr);
      }
      
      const [salesEntrySums, perEmployeeSales] = await Promise.all([
        db.select({
          eventId: eventSalesEntries.eventId,
          totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
          totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
          totalLeaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
          totalEbSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, eventIds)).groupBy(eventSalesEntries.eventId),
        db.select({
          eventId: eventSalesEntries.eventId,
          employeeId: eventSalesEntries.employeeId,
          simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
          ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
          leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
          ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        }).from(eventSalesEntries).where(inArray(eventSalesEntries.eventId, eventIds))
          .groupBy(eventSalesEntries.eventId, eventSalesEntries.employeeId),
      ]);
      const salesEntryMap2 = new Map(salesEntrySums.map(s => [s.eventId, s]));
      const perEmpSalesMap = new Map<string, typeof perEmployeeSales[0]>();
      for (const s of perEmployeeSales) {
        perEmpSalesMap.set(`${s.eventId}:${s.employeeId}`, s);
      }
      
      const allTeamPersNos = results.flatMap(e => (e.assignedTeam || []) as string[]);
      const uniquePersNos = [...new Set(allTeamPersNos)];
      let masterMap = new Map<string, { persNo: string; name: string; designation: string | null }>();
      let persNoToEmpIdMapMyEvents = new Map<string, string>();
      if (uniquePersNos.length > 0) {
        const empRowsForTeam = await db.select({ id: employees.id, persNo: employees.persNo, name: employees.name, designation: employees.designation })
          .from(employees)
          .where(inArray(employees.persNo, uniquePersNos));
        for (const row of empRowsForTeam) {
          if (row.persNo) {
            persNoToEmpIdMapMyEvents.set(row.persNo, row.id);
            masterMap.set(row.persNo, { persNo: row.persNo, name: row.name, designation: row.designation || null });
          }
        }
        const missingPersNosForMaster = uniquePersNos.filter(p => !masterMap.has(p));
        if (missingPersNosForMaster.length > 0) {
          const masterRecords = await db.select({
            persNo: employeeMaster.persNo,
            name: employeeMaster.name,
            designation: employeeMaster.designation,
          }).from(employeeMaster).where(inArray(employeeMaster.persNo, missingPersNosForMaster));
          for (const m of masterRecords) {
            masterMap.set(m.persNo, m);
          }
        }
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
        const eventAssigns = assignmentsByEventId.get(event.id) || [];
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
        
        const myAssignment = eventAssigns.find(a => a.employeeId === input.employeeId);
        
        let submissionStatus: string = 'not_started';
        if (myAssignment) {
          submissionStatus = myAssignment.submissionStatus || 'not_started';
        } else if (event.createdBy === input.employeeId || event.assignedTo === input.employeeId) {
          const statuses = eventAssigns.map(a => a.submissionStatus || 'not_started');
          if (statuses.includes('approved')) submissionStatus = 'approved';
          else if (statuses.includes('submitted')) submissionStatus = 'submitted';
          else if (statuses.includes('rejected')) submissionStatus = 'rejected';
          else if (statuses.includes('in_progress')) submissionStatus = 'in_progress';
        }
        
        const assignedTeamPurseIds = (event.assignedTeam || []) as string[];
        const evtCategories = (event.category || '').split(',').filter(Boolean);
        const evtHasSIM = evtCategories.includes('SIM');
        const evtHasFTTH = evtCategories.includes('FTTH');
        const evtHasLease = evtCategories.includes('LEASE_CIRCUIT');
        const evtHasBtsDown = evtCategories.includes('BTS_DOWN');
        const evtHasRouteFail = evtCategories.includes('ROUTE_FAIL');
        const evtHasFtthDown = evtCategories.includes('FTTH_DOWN');
        const evtHasOfcFail = evtCategories.includes('OFC_FAIL');
        const evtHasEb = evtCategories.includes('EB');

        const assignByEmpIdMyEv = new Map<string, typeof eventAssigns[0]>();
        for (const ea of eventAssigns) {
          assignByEmpIdMyEv.set(ea.employeeId, ea);
        }

        const teamMembers = assignedTeamPurseIds.map((persNo, idx) => {
          const member = masterMap.get(persNo);
          const empId = persNoToEmpIdMapMyEvents.get(persNo);
          const memberAssignment = empId ? assignByEmpIdMyEv.get(empId) : undefined;
          const empSales = empId ? perEmpSalesMap.get(`${event.id}:${empId}`) : undefined;
          const memberTeamSize = assignedTeamPurseIds.length || 1;
          const getDistTarget = (total: number) => {
            const base = Math.floor(total / memberTeamSize);
            const remainder = total % memberTeamSize;
            return idx < remainder ? base + 1 : base;
          };

          return {
            persNo,
            name: member?.name || persNo,
            designation: member?.designation || null,
            targets: {
              sim: memberAssignment ? memberAssignment.simTarget : (evtHasSIM ? getDistTarget(event.targetSim) : 0),
              ftth: memberAssignment ? memberAssignment.ftthTarget : (evtHasFTTH ? getDistTarget(event.targetFtth) : 0),
              lease: memberAssignment ? memberAssignment.leaseTarget : (evtHasLease ? getDistTarget(event.targetLease ?? 0) : 0),
              btsDown: memberAssignment ? memberAssignment.btsDownTarget : (evtHasBtsDown ? getDistTarget(event.targetBtsDown ?? 0) : 0),
              routeFail: memberAssignment ? memberAssignment.routeFailTarget : (evtHasRouteFail ? getDistTarget(event.targetRouteFail ?? 0) : 0),
              ftthDown: memberAssignment ? memberAssignment.ftthDownTarget : (evtHasFtthDown ? getDistTarget(event.targetFtthDown ?? 0) : 0),
              ofcFail: memberAssignment ? memberAssignment.ofcFailTarget : (evtHasOfcFail ? getDistTarget(event.targetOfcFail ?? 0) : 0),
              eb: memberAssignment ? memberAssignment.ebTarget : (evtHasEb ? getDistTarget(event.targetEb ?? 0) : 0),
            },
            progress: {
              simSold: Math.max(empSales ? Number(empSales.simsSold) : 0, memberAssignment?.simSold ?? 0),
              ftthSold: Math.max(empSales ? Number(empSales.ftthSold) : 0, memberAssignment?.ftthSold ?? 0),
              lease: Math.max(empSales ? Number(empSales.leaseSold) : 0, memberAssignment?.leaseCompleted ?? 0),
              btsDown: memberAssignment?.btsDownCompleted ?? 0,
              routeFail: memberAssignment?.routeFailCompleted ?? 0,
              ftthDown: memberAssignment?.ftthDownCompleted ?? 0,
              ofcFail: memberAssignment?.ofcFailCompleted ?? 0,
              eb: Math.max(empSales ? Number(empSales.ebSold) : 0, memberAssignment?.ebCompleted ?? 0),
            },
          };
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
          const rawAssignments = JSON.parse(input.teamAssignments) as Array<{
            employeePurseId: string;
            employeeName: string;
            linkedEmployeeId: string | null;
            taskIds: string[];
          }>;

          // Resolve every assignment to a real employeeId first, then deduplicate
          // and sort deterministically so the fair-split share order is stable
          // and reproducible across reruns.
          const resolved: Array<{ employeeId: string; taskIds: string[] }> = [];
          const seen = new Set<string>();
          for (const a of rawAssignments) {
            let employeeId = a.linkedEmployeeId;
            if (!employeeId) {
              const masterRecord = await db.select().from(employeeMaster)
                .where(eq(employeeMaster.persNo, a.employeePurseId));
              employeeId = masterRecord[0]?.linkedEmployeeId || null;
            }
            if (!employeeId || seen.has(employeeId)) continue;
            seen.add(employeeId);
            resolved.push({ employeeId, taskIds: Array.from(new Set(a.taskIds)) });
          }
          resolved.sort((x, y) => x.employeeId.localeCompare(y.employeeId));

          // Build per-task-type assignee lists and fair shares so each task's
          // shares sum exactly to the event's target (no over- or
          // under-allocation regardless of odd/even totals or team sizes).
          type TaskKey = 'SIM' | 'FTTH' | 'LEASE_CIRCUIT' | 'EB' | 'BTS_DOWN' | 'FTTH_DOWN' | 'ROUTE_FAIL' | 'OFC_FAIL';
          const TASK_TOTALS: Record<TaskKey, number> = {
            SIM: input.targetSim,
            FTTH: input.targetFtth,
            LEASE_CIRCUIT: input.targetLease || 0,
            EB: input.targetEb || 0,
            BTS_DOWN: input.targetBtsDown || 0,
            FTTH_DOWN: input.targetFtthDown || 0,
            ROUTE_FAIL: input.targetRouteFail || 0,
            OFC_FAIL: input.targetOfcFail || 0,
          };
          const TASK_KEYS: TaskKey[] = ['SIM', 'FTTH', 'LEASE_CIRCUIT', 'EB', 'BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL'];

          // For each task type: array of indices into `resolved` that have it.
          const taskAssignees: Record<TaskKey, number[]> = {
            SIM: [], FTTH: [], LEASE_CIRCUIT: [], EB: [],
            BTS_DOWN: [], FTTH_DOWN: [], ROUTE_FAIL: [], OFC_FAIL: [],
          };
          resolved.forEach((r, idx) => {
            for (const tk of TASK_KEYS) if (r.taskIds.includes(tk)) taskAssignees[tk].push(idx);
          });

          // Compute the share each member gets per task type.
          const shares: Record<TaskKey, Map<number, number>> = {
            SIM: new Map(), FTTH: new Map(), LEASE_CIRCUIT: new Map(), EB: new Map(),
            BTS_DOWN: new Map(), FTTH_DOWN: new Map(), ROUTE_FAIL: new Map(), OFC_FAIL: new Map(),
          };
          for (const tk of TASK_KEYS) {
            const idxs = taskAssignees[tk];
            const split = distributeFairly(TASK_TOTALS[tk], idxs.length);
            idxs.forEach((memberIdx, i) => shares[tk].set(memberIdx, split[i] ?? 0));
          }

          // Persist one row per resolved assignee. Targets for task types the
          // member is NOT assigned to are 0 by default.
          for (let i = 0; i < resolved.length; i++) {
            const { employeeId, taskIds } = resolved[i];
            const targets = {
              simTarget: shares.SIM.get(i) ?? 0,
              ftthTarget: shares.FTTH.get(i) ?? 0,
              leaseTarget: shares.LEASE_CIRCUIT.get(i) ?? 0,
              ebTarget: shares.EB.get(i) ?? 0,
              btsDownTarget: shares.BTS_DOWN.get(i) ?? 0,
              ftthDownTarget: shares.FTTH_DOWN.get(i) ?? 0,
              routeFailTarget: shares.ROUTE_FAIL.get(i) ?? 0,
              ofcFailTarget: shares.OFC_FAIL.get(i) ?? 0,
            };

            const existingAssignment = await db.select().from(eventAssignments)
              .where(and(
                eq(eventAssignments.eventId, result[0].id),
                eq(eventAssignments.employeeId, employeeId)
              ));

            if (!existingAssignment[0]) {
              await db.insert(eventAssignments).values({
                eventId: result[0].id,
                employeeId,
                ...targets,
                assignedTaskTypes: taskIds,
                assignedBy: input.createdBy,
              });
            } else {
              await db.update(eventAssignments)
                .set({ ...targets, assignedTaskTypes: taskIds, updatedAt: new Date() })
                .where(eq(eventAssignments.id, existingAssignment[0].id));
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
        .where(and(
          eq(eventSalesEntries.eventId, input.id),
          eq(eventSalesEntries.entryStatus, 'active')
        ))
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
      btsDownTarget: z.number().min(0).optional(),
      ftthDownTarget: z.number().min(0).optional(),
      routeFailTarget: z.number().min(0).optional(),
      ofcFailTarget: z.number().min(0).optional(),
      assignedTaskTypes: z.array(z.string()).optional(),
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const leaseTarget = input.leaseTarget ?? 0;
      const ebTarget = input.ebTarget ?? 0;
      const btsDownTarget = input.btsDownTarget ?? 0;
      const ftthDownTarget = input.ftthDownTarget ?? 0;
      const routeFailTarget = input.routeFailTarget ?? 0;
      const ofcFailTarget = input.ofcFailTarget ?? 0;
      
      let assignedTaskTypes = input.assignedTaskTypes;
      if (!assignedTaskTypes) {
        assignedTaskTypes = [];
        if (input.simTarget > 0) assignedTaskTypes.push('SIM');
        if (input.ftthTarget > 0) assignedTaskTypes.push('FTTH');
        if (leaseTarget > 0) assignedTaskTypes.push('LEASE_CIRCUIT');
        if (ebTarget > 0) assignedTaskTypes.push('EB');
        if (btsDownTarget > 0) assignedTaskTypes.push('BTS_DOWN');
        if (ftthDownTarget > 0) assignedTaskTypes.push('FTTH_DOWN');
        if (routeFailTarget > 0) assignedTaskTypes.push('ROUTE_FAIL');
        if (ofcFailTarget > 0) assignedTaskTypes.push('OFC_FAIL');
      }
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const existing = allAssignments.find(a => a.employeeId === input.employeeId);
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== input.employeeId);
      const sumOther = (k: keyof typeof otherAssignments[number]) =>
        otherAssignments.reduce((sum, a) => sum + (Number((a as any)[k]) || 0), 0);

      // Validate each task target against the event's TARGET (not the
      // resource allocation). Targets define how much work to do; allocations
      // are inventory consumed during execution. Mixing them caused
      // assignments to be silently capped or rejected at edit time.
      const checks: Array<{ label: string; eventTotal: number; current: number; requested: number }> = [
        { label: 'SIM',           eventTotal: event[0].targetSim,                current: sumOther('simTarget'),       requested: input.simTarget },
        { label: 'FTTH',          eventTotal: event[0].targetFtth,               current: sumOther('ftthTarget'),      requested: input.ftthTarget },
        { label: 'Lease Circuit', eventTotal: event[0].targetLease ?? 0,         current: sumOther('leaseTarget'),     requested: leaseTarget },
        { label: 'EB',            eventTotal: event[0].targetEb ?? 0,            current: sumOther('ebTarget'),        requested: ebTarget },
        { label: 'BTS-Down',      eventTotal: event[0].targetBtsDown ?? 0,       current: sumOther('btsDownTarget'),   requested: btsDownTarget },
        { label: 'FTTH-Down',     eventTotal: event[0].targetFtthDown ?? 0,      current: sumOther('ftthDownTarget'),  requested: ftthDownTarget },
        { label: 'Route-Fail',    eventTotal: event[0].targetRouteFail ?? 0,     current: sumOther('routeFailTarget'), requested: routeFailTarget },
        { label: 'OFC-Fail',      eventTotal: event[0].targetOfcFail ?? 0,       current: sumOther('ofcFailTarget'),   requested: ofcFailTarget },
      ];
      for (const c of checks) {
        if (c.requested === 0) continue;
        if (c.eventTotal === 0) {
          throw new Error(`Cannot assign ${c.requested} ${c.label}: event has no ${c.label} target set.`);
        }
        if (c.current + c.requested > c.eventTotal) {
          const available = Math.max(0, c.eventTotal - c.current);
          throw new Error(`Cannot assign ${c.requested} ${c.label}. Only ${available} ${c.label} available for distribution (event target ${c.eventTotal}, already distributed ${c.current}).`);
        }
      }
      
      if (existing) {
        await db.update(eventAssignments)
          .set({
            simTarget: input.simTarget,
            ftthTarget: input.ftthTarget,
            leaseTarget,
            ebTarget,
            btsDownTarget,
            ftthDownTarget,
            routeFailTarget,
            ofcFailTarget,
            assignedTaskTypes,
            updatedAt: new Date(),
          })
          .where(eq(eventAssignments.id, existing.id));
      } else {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: input.employeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          leaseTarget,
          ebTarget,
          btsDownTarget,
          ftthDownTarget,
          routeFailTarget,
          ofcFailTarget,
          assignedTaskTypes,
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
        details: {
          employeeId: input.employeeId,
          simTarget: input.simTarget, ftthTarget: input.ftthTarget,
          leaseTarget, ebTarget,
          btsDownTarget, ftthDownTarget, routeFailTarget, ofcFailTarget,
          assignedTaskTypes,
        },
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

  /**
   * Re-balance targets across the current team using the same fair-split
   * algorithm used at create time. Useful after team composition changes
   * (members added/removed, task-type toggles changed, etc.) so the sum of
   * per-member targets always matches the event total exactly.
   *
   * Only the event creator or assignedTo manager may run this. Sold/completed
   * counters are preserved; only target columns are updated.
   */
  redistributeTargets: authedProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      performedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      // Run inside a serializable-ish read+write window: SELECT FOR UPDATE on
      // the event row blocks concurrent assignTeamMember / redistribute calls
      // from racing on stale assignment state.
      return await db.transaction(async (tx) => {
        const eventRows = await tx.execute(
          sql`SELECT * FROM ${events} WHERE ${events.id} = ${input.eventId} FOR UPDATE`
        );
        const eventRow = (eventRows as any).rows?.[0] ?? (eventRows as any)[0];
        if (!eventRow) throw new Error('Event not found');

        // Authorisation: creator or current assignedTo manager only.
        if (input.performedBy !== eventRow.created_by && input.performedBy !== eventRow.assigned_to) {
          throw new Error('Only the event creator or assigned manager can redistribute targets.');
        }

        const assignments = await tx.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));

        if (assignments.length === 0) {
          return { success: true, updated: 0, overflow: {} as Record<string, number> };
        }

        // Deterministic order so re-running produces identical shares.
        const ordered = [...assignments].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

        type TaskKey = 'SIM' | 'FTTH' | 'LEASE_CIRCUIT' | 'EB' | 'BTS_DOWN' | 'FTTH_DOWN' | 'ROUTE_FAIL' | 'OFC_FAIL';
        const TASK_KEYS: TaskKey[] = ['SIM', 'FTTH', 'LEASE_CIRCUIT', 'EB', 'BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL'];
        const TASK_TOTALS: Record<TaskKey, number> = {
          SIM:           Number(eventRow.target_sim ?? 0),
          FTTH:          Number(eventRow.target_ftth ?? 0),
          LEASE_CIRCUIT: Number(eventRow.target_lease ?? 0),
          EB:            Number(eventRow.target_eb ?? 0),
          BTS_DOWN:      Number(eventRow.target_bts_down ?? 0),
          FTTH_DOWN:     Number(eventRow.target_ftth_down ?? 0),
          ROUTE_FAIL:    Number(eventRow.target_route_fail ?? 0),
          OFC_FAIL:      Number(eventRow.target_ofc_fail ?? 0),
        };

        // Member opts in to a task type if (a) it's in their assignedTaskTypes
        // OR (b) they currently hold a non-zero target for it (legacy rows
        // without assignedTaskTypes still honour their existing assignment).
        const memberHas = (a: typeof ordered[number], tk: TaskKey): boolean => {
          const tt = (a.assignedTaskTypes || []) as string[];
          if (tt.includes(tk)) return true;
          switch (tk) {
            case 'SIM':           return a.simTarget > 0;
            case 'FTTH':          return a.ftthTarget > 0;
            case 'LEASE_CIRCUIT': return a.leaseTarget > 0;
            case 'EB':            return a.ebTarget > 0;
            case 'BTS_DOWN':      return a.btsDownTarget > 0;
            case 'FTTH_DOWN':     return a.ftthDownTarget > 0;
            case 'ROUTE_FAIL':    return a.routeFailTarget > 0;
            case 'OFC_FAIL':      return a.ofcFailTarget > 0;
          }
        };

        const soldOf = (a: typeof ordered[number], tk: TaskKey): number => {
          switch (tk) {
            case 'SIM':           return a.simSold;
            case 'FTTH':          return a.ftthSold;
            case 'LEASE_CIRCUIT': return a.leaseCompleted;
            case 'EB':            return a.ebCompleted;
            case 'BTS_DOWN':      return a.btsDownCompleted;
            case 'FTTH_DOWN':     return a.ftthDownCompleted;
            case 'ROUTE_FAIL':    return a.routeFailCompleted;
            case 'OFC_FAIL':      return a.ofcFailCompleted;
          }
        };

        // Final per-task per-member shares after fair-split, clamp-up to sold,
        // and excess trimming from members with slack.
        const shares: Record<TaskKey, Map<number, number>> = {
          SIM: new Map(), FTTH: new Map(), LEASE_CIRCUIT: new Map(), EB: new Map(),
          BTS_DOWN: new Map(), FTTH_DOWN: new Map(), ROUTE_FAIL: new Map(), OFC_FAIL: new Map(),
        };
        // Per-task remaining overflow we couldn't trim away (sold > event total).
        const overflow: Record<string, number> = {};

        for (const tk of TASK_KEYS) {
          const idxs: number[] = [];
          ordered.forEach((a, i) => { if (memberHas(a, tk)) idxs.push(i); });
          if (idxs.length === 0) continue;

          // Initial fair split summing to TASK_TOTALS[tk].
          const initial = distributeFairly(TASK_TOTALS[tk], idxs.length);
          // Per-member working share, clamped UP to their sold/completed floor.
          const work = idxs.map((m, j) => Math.max(initial[j] ?? 0, soldOf(ordered[m], tk)));
          let sum = work.reduce((s, v) => s + v, 0);
          let excess = sum - TASK_TOTALS[tk];

          // Trim excess from members whose share > floor (round-robin, -1 each
          // pass) until we hit the event total or no slack remains.
          if (excess > 0) {
            let safety = excess + idxs.length; // bounded by slack pool size
            while (excess > 0 && safety-- > 0) {
              let trimmedThisPass = 0;
              for (let j = 0; j < work.length && excess > 0; j++) {
                const floor = soldOf(ordered[idxs[j]], tk);
                if (work[j] > floor) {
                  work[j] -= 1;
                  excess -= 1;
                  trimmedThisPass++;
                }
              }
              if (trimmedThisPass === 0) break; // no member has slack
            }
            if (excess > 0) {
              // Sold totals genuinely exceed the event target — surface to UI
              // and audit log so the manager knows the goal was over-shot.
              overflow[tk] = excess;
            }
          }

          idxs.forEach((m, j) => shares[tk].set(m, work[j]));
        }

        let updated = 0;
        for (let i = 0; i < ordered.length; i++) {
          const a = ordered[i];
          const newTargets = {
            simTarget:       shares.SIM.get(i) ?? 0,
            ftthTarget:      shares.FTTH.get(i) ?? 0,
            leaseTarget:     shares.LEASE_CIRCUIT.get(i) ?? 0,
            ebTarget:        shares.EB.get(i) ?? 0,
            btsDownTarget:   shares.BTS_DOWN.get(i) ?? 0,
            ftthDownTarget:  shares.FTTH_DOWN.get(i) ?? 0,
            routeFailTarget: shares.ROUTE_FAIL.get(i) ?? 0,
            ofcFailTarget:   shares.OFC_FAIL.get(i) ?? 0,
          };
          await tx.update(eventAssignments)
            .set({ ...newTargets, updatedAt: new Date() })
            .where(eq(eventAssignments.id, a.id));
          updated++;
        }

        await tx.insert(auditLogs).values({
          action: 'REDISTRIBUTE_TARGETS',
          entityType: 'EVENT',
          entityId: input.eventId,
          performedBy: input.performedBy,
          details: { teamSize: ordered.length, totals: TASK_TOTALS, overflow },
        });

        return { success: true, updated, overflow };
      });
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

  submitEventSales: authedProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      // Optional legacy employeeId — IGNORED on server; actor derived from session.
      employeeId: z.string().uuid().optional(),
      simsSold: z.number().min(0).optional().default(0),
      simsActivated: z.number().min(0).optional().default(0),
      ftthSold: z.number().min(0).optional().default(0),
      ftthActivated: z.number().min(0).optional().default(0),
      leaseSold: z.number().min(0).optional().default(0),
      ebSold: z.number().min(0).optional().default(0),
      customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']),
      // NEW: structured line-items per subtype (preferred path)
      simLines: z.array(z.object({
        mobileNumber: z.string().regex(/^[6-9]\d{9}$/, 'Mobile number must be 10 digits starting with 6-9'),
        simSerialNumber: z.string().optional(),
        customerName: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
        isActivated: z.boolean().optional().default(true),
      })).optional().default([]),
      ftthLines: z.array(z.object({
        ftthId: z.string().min(1, 'FTTH ID is required').max(50),
        customerName: z.string().optional(),
        customerContact: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
        planName: z.string().optional(),
        isActivated: z.boolean().optional().default(true),
      })).optional().default([]),
      lcLines: z.array(z.object({
        circuitId: z.string().min(1, 'Circuit ID is required').max(100),
        customerName: z.string().min(1, 'Customer name is required'),
        customerContact: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
        bandwidth: z.string().optional(),
        endpointA: z.string().optional(),
        endpointB: z.string().optional(),
      })).optional().default([]),
      ebLines: z.array(z.object({
        connectionId: z.string().min(1, 'Connection ID is required').max(100),
        meterNumber: z.string().optional(),
        customerName: z.string().min(1, 'Customer name is required'),
        customerContact: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
        siteAddress: z.string().optional(),
        loadKw: z.string().optional(),
      })).optional().default([]),
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
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId;

      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");

      if (event[0].status === 'completed' || event[0].status === 'cancelled') {
        throw new Error(`Cannot submit sales for ${event[0].status} event`);
      }

      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, employeeId)
        ));

      if (!assignment[0]) {
        throw new Error("You are not assigned to this event. Please contact the event manager.");
      }

      // Photo + GPS enforcement
      if (!input.photos || input.photos.length === 0) {
        throw new Error("At least one geo-tagged photo is required to submit a sales entry.");
      }
      if (!input.gpsLatitude || !input.gpsLongitude) {
        throw new Error("GPS location is required. Please tap 'Capture GPS Location' before submitting.");
      }
      const submitLat = parseFloat(input.gpsLatitude);
      const submitLng = parseFloat(input.gpsLongitude);
      if (!Number.isFinite(submitLat) || !Number.isFinite(submitLng)) {
        throw new Error("Invalid GPS coordinates.");
      }

      // Geo-fence: anchor = avg GPS of prior active entries for this event (lazy-init from first entry)
      const priorWithGps = await db.select({
        lat: eventSalesEntries.gpsLatitude,
        lng: eventSalesEntries.gpsLongitude,
      })
        .from(eventSalesEntries)
        .where(and(
          eq(eventSalesEntries.eventId, input.eventId),
          eq(eventSalesEntries.entryStatus, 'active'),
          isNotNull(eventSalesEntries.gpsLatitude),
          isNotNull(eventSalesEntries.gpsLongitude),
        ))
        .limit(50);

      let geoWarning: string | null = null;
      if (priorWithGps.length > 0) {
        const valid = priorWithGps
          .map(p => ({ lat: parseFloat(p.lat as string), lng: parseFloat(p.lng as string) }))
          .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (valid.length > 0) {
          const anchorLat = valid.reduce((s, p) => s + p.lat, 0) / valid.length;
          const anchorLng = valid.reduce((s, p) => s + p.lng, 0) / valid.length;
          const distKm = haversineKm(anchorLat, anchorLng, submitLat, submitLng);
          if (distKm > GEO_FENCE_KM * GEO_FENCE_HARD_MULT) {
            throw new Error(
              `Submission location is ${distKm.toFixed(1)} km from the event area (limit ${GEO_FENCE_KM * GEO_FENCE_HARD_MULT} km). Please verify your GPS location.`
            );
          }
          if (distKm > GEO_FENCE_KM) {
            geoWarning = `Submission location is ${distKm.toFixed(1)} km from the event area (soft limit ${GEO_FENCE_KM} km).`;
            if (GEO_FENCE_ENFORCE === 'hard') {
              throw new Error(geoWarning);
            }
            console.warn(`[geo-fence] event=${input.eventId} employee=${employeeId} distKm=${distKm.toFixed(2)}`);
          }
        }
      }

      // Derive effective counts: lines take precedence when provided
      const effSimsSold = input.simLines.length > 0 ? Math.max(input.simsSold, input.simLines.length) : input.simsSold;
      const effSimsActivated = input.simLines.length > 0 ? input.simLines.filter(l => l.isActivated).length : input.simsActivated;
      const effFtthSold = input.ftthLines.length > 0 ? Math.max(input.ftthSold, input.ftthLines.length) : input.ftthSold;
      const effFtthActivated = input.ftthLines.length > 0 ? input.ftthLines.filter(l => l.isActivated).length : input.ftthActivated;
      const effLeaseSold = input.lcLines.length > 0 ? input.lcLines.length : input.leaseSold;
      const effEbSold = input.ebLines.length > 0 ? input.ebLines.length : input.ebSold;

      // Parity: if user provided activated count without lines for SIM/FTTH, that's allowed (legacy);
      //   if lines provided, lines.length must equal activated count when activated explicitly given.
      if (input.simLines.length > 0 && input.simsActivated > 0 && input.simLines.filter(l => l.isActivated).length !== input.simsActivated) {
        throw new Error(`SIMs Activated (${input.simsActivated}) must match number of activated mobile numbers entered (${input.simLines.filter(l => l.isActivated).length}).`);
      }
      if (input.ftthLines.length > 0 && input.ftthActivated > 0 && input.ftthLines.filter(l => l.isActivated).length !== input.ftthActivated) {
        throw new Error(`FTTH Activated (${input.ftthActivated}) must match number of FTTH IDs entered (${input.ftthLines.filter(l => l.isActivated).length}).`);
      }

      // Sanity: cannot have more activated than sold
      if (effSimsActivated > effSimsSold) {
        throw new Error('SIMs Activated cannot exceed SIMs Sold.');
      }
      if (effFtthActivated > effFtthSold) {
        throw new Error('FTTH Activated cannot exceed FTTH Sold.');
      }

      // Assignment-type checks — apply to ANY work in that subtype (sold OR activated OR lines)
      const assignedTypes = (assignment[0].assignedTaskTypes as string[]) || [];
      const hasAssignedTypes = assignedTypes.length > 0;
      if (hasAssignedTypes) {
        const touchesSim = effSimsSold > 0 || effSimsActivated > 0 || input.simLines.length > 0;
        const touchesFtth = effFtthSold > 0 || effFtthActivated > 0 || input.ftthLines.length > 0;
        const touchesLc = effLeaseSold > 0 || input.lcLines.length > 0;
        const touchesEb = effEbSold > 0 || input.ebLines.length > 0;
        if (touchesSim && !assignedTypes.includes('SIM')) throw new Error('You are not assigned to SIM tasks');
        if (touchesFtth && !assignedTypes.includes('FTTH')) throw new Error('You are not assigned to FTTH tasks');
        if (touchesLc && !assignedTypes.includes('LEASE_CIRCUIT')) throw new Error('You are not assigned to Lease Circuit tasks');
        if (touchesEb && !assignedTypes.includes('EB')) throw new Error('You are not assigned to EB tasks');
      }

      // Format/uniqueness for line items — within submission
      const simNumbers = input.simLines.map(l => l.mobileNumber);
      if (new Set(simNumbers).size !== simNumbers.length) {
        throw new Error('Duplicate mobile numbers in this submission.');
      }
      const ftthIds = input.ftthLines.map(l => l.ftthId);
      if (new Set(ftthIds).size !== ftthIds.length) {
        throw new Error('Duplicate FTTH IDs in this submission.');
      }
      const lcIds = input.lcLines.map(l => l.circuitId);
      if (new Set(lcIds).size !== lcIds.length) {
        throw new Error('Duplicate Lease Circuit IDs in this submission.');
      }
      const ebIds = input.ebLines.map(l => l.connectionId);
      if (new Set(ebIds).size !== ebIds.length) {
        throw new Error('Duplicate EB Connection IDs in this submission.');
      }

      // Cross-event uniqueness (against active prior submissions in this event)
      if (simNumbers.length > 0) {
        const dup = await db.select({ n: simSaleLines.mobileNumber })
          .from(simSaleLines)
          .innerJoin(eventSalesEntries, eq(simSaleLines.entryId, eventSalesEntries.id))
          .where(and(
            eq(simSaleLines.eventId, input.eventId),
            inArray(simSaleLines.mobileNumber, simNumbers),
            eq(eventSalesEntries.entryStatus, 'active')
          ));
        if (dup.length > 0) {
          throw new Error(`Mobile number(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
        }
      }
      if (ftthIds.length > 0) {
        const dup = await db.select({ n: ftthSaleLines.ftthId })
          .from(ftthSaleLines)
          .innerJoin(eventSalesEntries, eq(ftthSaleLines.entryId, eventSalesEntries.id))
          .where(and(
            eq(ftthSaleLines.eventId, input.eventId),
            inArray(ftthSaleLines.ftthId, ftthIds),
            eq(eventSalesEntries.entryStatus, 'active')
          ));
        if (dup.length > 0) {
          throw new Error(`FTTH ID(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
        }
      }
      if (lcIds.length > 0) {
        const dup = await db.select({ n: lcSaleLines.circuitId })
          .from(lcSaleLines)
          .innerJoin(eventSalesEntries, eq(lcSaleLines.entryId, eventSalesEntries.id))
          .where(and(
            eq(lcSaleLines.eventId, input.eventId),
            inArray(lcSaleLines.circuitId, lcIds),
            eq(eventSalesEntries.entryStatus, 'active')
          ));
        if (dup.length > 0) {
          throw new Error(`Circuit ID(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
        }
      }
      if (ebIds.length > 0) {
        const dup = await db.select({ n: ebSaleLines.connectionId })
          .from(ebSaleLines)
          .innerJoin(eventSalesEntries, eq(ebSaleLines.entryId, eventSalesEntries.id))
          .where(and(
            eq(ebSaleLines.eventId, input.eventId),
            inArray(ebSaleLines.connectionId, ebIds),
            eq(eventSalesEntries.entryStatus, 'active')
          ));
        if (dup.length > 0) {
          throw new Error(`EB Connection ID(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
        }
      }

      // Insert parent entry + child line items in a transaction.
      // Re-read assignment with SELECT ... FOR UPDATE to prevent race conditions
      // between concurrent submissions blowing through the target.
      const result = await db.transaction(async (tx) => {
        const [lockedAssignment] = await tx.select().from(eventAssignments)
          .where(eq(eventAssignments.id, assignment[0].id))
          .for('update');
        if (!lockedAssignment) {
          throw new Error('Assignment vanished during submission. Please retry.');
        }

        const newTotalSim = lockedAssignment.simSold + effSimsSold;
        const newTotalFtth = lockedAssignment.ftthSold + effFtthSold;
        const newTotalLease = (lockedAssignment.leaseCompleted || 0) + effLeaseSold;
        const newTotalEb = (lockedAssignment.ebCompleted || 0) + effEbSold;

        if (effSimsSold > 0 && newTotalSim > lockedAssignment.simTarget) {
          const remaining = lockedAssignment.simTarget - lockedAssignment.simSold;
          throw new Error(`Cannot sell ${effSimsSold} SIMs. Only ${remaining} remaining in your target. Contact manager to increase target.`);
        }
        if (effFtthSold > 0 && newTotalFtth > lockedAssignment.ftthTarget) {
          const remaining = lockedAssignment.ftthTarget - lockedAssignment.ftthSold;
          throw new Error(`Cannot sell ${effFtthSold} FTTH. Only ${remaining} remaining in your target. Contact manager to increase target.`);
        }
        if (effLeaseSold > 0 && newTotalLease > (lockedAssignment.leaseTarget || 0)) {
          const remaining = (lockedAssignment.leaseTarget || 0) - (lockedAssignment.leaseCompleted || 0);
          throw new Error(`Cannot sell ${effLeaseSold} Lease Circuit. Only ${remaining} remaining in your target. Contact manager to increase target.`);
        }
        if (effEbSold > 0 && newTotalEb > (lockedAssignment.ebTarget || 0)) {
          const remaining = (lockedAssignment.ebTarget || 0) - (lockedAssignment.ebCompleted || 0);
          throw new Error(`Cannot sell ${effEbSold} EB. Only ${remaining} remaining in your target. Contact manager to increase target.`);
        }

        const [entry] = await tx.insert(eventSalesEntries).values({
          eventId: input.eventId,
          employeeId,
          simsSold: effSimsSold,
          simsActivated: effSimsActivated,
          ftthSold: effFtthSold,
          ftthActivated: effFtthActivated,
          leaseSold: effLeaseSold,
          ebSold: effEbSold,
          customerType: input.customerType,
          photos: input.photos || [],
          gpsLatitude: input.gpsLatitude,
          gpsLongitude: input.gpsLongitude,
          remarks: input.remarks,
        }).returning();

        if (input.simLines.length > 0) {
          await tx.insert(simSaleLines).values(input.simLines.map(l => ({
            entryId: entry.id,
            eventId: input.eventId,
            employeeId,
            mobileNumber: l.mobileNumber,
            simSerialNumber: l.simSerialNumber,
            customerName: l.customerName,
            customerType: l.customerType ?? input.customerType,
            isActivated: l.isActivated ?? true,
          })));
        }
        if (input.ftthLines.length > 0) {
          await tx.insert(ftthSaleLines).values(input.ftthLines.map(l => ({
            entryId: entry.id,
            eventId: input.eventId,
            employeeId,
            ftthId: l.ftthId,
            customerName: l.customerName,
            customerContact: l.customerContact,
            customerType: l.customerType ?? input.customerType,
            planName: l.planName,
            isActivated: l.isActivated ?? true,
          })));
        }
        if (input.lcLines.length > 0) {
          await tx.insert(lcSaleLines).values(input.lcLines.map(l => ({
            entryId: entry.id,
            eventId: input.eventId,
            employeeId,
            circuitId: l.circuitId,
            customerName: l.customerName,
            customerContact: l.customerContact,
            customerType: l.customerType ?? input.customerType,
            bandwidth: l.bandwidth,
            endpointA: l.endpointA,
            endpointB: l.endpointB,
          })));
        }
        if (input.ebLines.length > 0) {
          await tx.insert(ebSaleLines).values(input.ebLines.map(l => ({
            entryId: entry.id,
            eventId: input.eventId,
            employeeId,
            connectionId: l.connectionId,
            meterNumber: l.meterNumber,
            customerName: l.customerName,
            customerContact: l.customerContact,
            customerType: l.customerType ?? input.customerType,
            siteAddress: l.siteAddress,
            loadKw: l.loadKw,
          })));
        }

        // Atomic increment using SQL expression (the row is FOR UPDATE-locked above)
        const assignmentUpdate: any = {
          simSold: sql`${eventAssignments.simSold} + ${effSimsSold}`,
          ftthSold: sql`${eventAssignments.ftthSold} + ${effFtthSold}`,
          updatedAt: new Date(),
        };
        if (effLeaseSold > 0) assignmentUpdate.leaseCompleted = sql`${eventAssignments.leaseCompleted} + ${effLeaseSold}`;
        if (effEbSold > 0) assignmentUpdate.ebCompleted = sql`${eventAssignments.ebCompleted} + ${effEbSold}`;
        await tx.update(eventAssignments)
          .set(assignmentUpdate)
          .where(eq(eventAssignments.id, lockedAssignment.id));

        return entry;
      });

      // Roll up lease/eb to event-level
      if (effLeaseSold > 0 || effEbSold > 0) {
        const allAssignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        const eventUpdate: any = { updatedAt: new Date() };
        if (effLeaseSold > 0) {
          eventUpdate.leaseCompleted = allAssignments.reduce((sum, a) => sum + (a.leaseCompleted || 0), 0);
          if (!event[0].leaseStartedAt && eventUpdate.leaseCompleted > 0) {
            eventUpdate.leaseStartedAt = new Date();
          }
        }
        if (effEbSold > 0) {
          eventUpdate.ebCompleted = allAssignments.reduce((sum, a) => sum + (a.ebCompleted || 0), 0);
          if (!event[0].ebStartedAt && eventUpdate.ebCompleted > 0) {
            eventUpdate.ebStartedAt = new Date();
          }
        }
        await db.update(events)
          .set(eventUpdate)
          .where(eq(events.id, input.eventId));
      }

      // Resource usage
      if (effSimsSold > 0) {
        const simResource = await db.select().from(resources)
          .where(and(eq(resources.circle, event[0].circle), eq(resources.type, 'SIM')));
        if (simResource[0]) {
          await db.update(resources)
            .set({ used: simResource[0].used + effSimsSold, updatedAt: new Date() })
            .where(eq(resources.id, simResource[0].id));
        }
      }
      if (effFtthSold > 0) {
        const ftthResource = await db.select().from(resources)
          .where(and(eq(resources.circle, event[0].circle), eq(resources.type, 'FTTH')));
        if (ftthResource[0]) {
          await db.update(resources)
            .set({ used: ftthResource[0].used + effFtthSold, updatedAt: new Date() })
            .where(eq(resources.id, ftthResource[0].id));
        }
      }

      await db.insert(auditLogs).values({
        action: 'SUBMIT_EVENT_SALES',
        entityType: 'SALES',
        entityId: result.id,
        performedBy: employeeId,
        details: {
          eventId: input.eventId,
          simsSold: effSimsSold,
          simsActivated: effSimsActivated,
          ftthSold: effFtthSold,
          ftthActivated: effFtthActivated,
          leaseSold: effLeaseSold,
          ebSold: effEbSold,
          simLineCount: input.simLines.length,
          ftthLineCount: input.ftthLines.length,
          lcLineCount: input.lcLines.length,
          ebLineCount: input.ebLines.length,
        },
      });

      return result;
    }),

  getEventSalesEntries: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      includeDeleted: z.boolean().optional().default(false),
    }))
    .query(async ({ input }) => {
      const entries = await db.select().from(eventSalesEntries)
        .where(input.includeDeleted
          ? eq(eventSalesEntries.eventId, input.eventId)
          : and(
              eq(eventSalesEntries.eventId, input.eventId),
              eq(eventSalesEntries.entryStatus, 'active')
            )
        )
        .orderBy(desc(eventSalesEntries.createdAt));
      return entries;
    }),

  getSalesEntryWithLines: publicProcedure
    .input(z.object({ entryId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [entry] = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.id, input.entryId));
      if (!entry) throw new Error('Sales entry not found');
      const [simLines, ftthLines, lcLines, ebLines] = await Promise.all([
        db.select().from(simSaleLines).where(eq(simSaleLines.entryId, input.entryId)),
        db.select().from(ftthSaleLines).where(eq(ftthSaleLines.entryId, input.entryId)),
        db.select().from(lcSaleLines).where(eq(lcSaleLines.entryId, input.entryId)),
        db.select().from(ebSaleLines).where(eq(ebSaleLines.entryId, input.entryId)),
      ]);
      return { entry, simLines, ftthLines, lcLines, ebLines };
    }),

  // Soft-delete a sales entry. Authorized actor: the entry's creator OR the event's creator/manager.
  // Adjusts assignment counters and event-level rollups by the entry's amounts.
  deleteSalesEntry: authedProcedure
    .input(z.object({
      entryId: z.string().uuid(),
      reason: z.string().min(3, 'Please provide a reason of at least 3 characters'),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.employeeId;
      const [entry] = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.id, input.entryId));
      if (!entry) throw new Error('Sales entry not found');
      if (entry.entryStatus !== 'active') {
        throw new Error(`Cannot delete an entry with status ${entry.entryStatus}`);
      }

      const [event] = await db.select().from(events).where(eq(events.id, entry.eventId));
      if (!event) throw new Error('Event not found');
      const isOwner = entry.employeeId === actor;
      const isEventCreator = event.createdBy === actor;
      const isEventManager = event.assignedTo === actor;
      if (!isOwner && !isEventCreator && !isEventManager) {
        throw new Error('You are not authorized to delete this sales entry');
      }

      await db.transaction(async (tx) => {
        await tx.update(eventSalesEntries)
          .set({
            entryStatus: 'deleted',
            deletedAt: new Date(),
            deletedBy: actor,
            reviewRemarks: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(eventSalesEntries.id, entry.id));

        // Subtract from assignment counters (atomic, lock-free via SQL expressions)
        const [assignment] = await tx.select().from(eventAssignments)
          .where(and(
            eq(eventAssignments.eventId, entry.eventId),
            eq(eventAssignments.employeeId, entry.employeeId)
          ));
        if (assignment) {
          await tx.update(eventAssignments)
            .set({
              simSold: sql`GREATEST(0, ${eventAssignments.simSold} - ${entry.simsSold || 0})`,
              ftthSold: sql`GREATEST(0, ${eventAssignments.ftthSold} - ${entry.ftthSold || 0})`,
              leaseCompleted: sql`GREATEST(0, ${eventAssignments.leaseCompleted} - ${entry.leaseSold || 0})`,
              ebCompleted: sql`GREATEST(0, ${eventAssignments.ebCompleted} - ${entry.ebSold || 0})`,
              updatedAt: new Date(),
            })
            .where(eq(eventAssignments.id, assignment.id));
        }

        // Roll back resources.used for SIM/FTTH so circle inventory stays accurate
        if ((entry.simsSold || 0) > 0) {
          const [simResource] = await tx.select().from(resources)
            .where(and(eq(resources.circle, event.circle), eq(resources.type, 'SIM')));
          if (simResource) {
            await tx.update(resources)
              .set({
                used: sql`GREATEST(0, ${resources.used} - ${entry.simsSold || 0})`,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, simResource.id));
          }
        }
        if ((entry.ftthSold || 0) > 0) {
          const [ftthResource] = await tx.select().from(resources)
            .where(and(eq(resources.circle, event.circle), eq(resources.type, 'FTTH')));
          if (ftthResource) {
            await tx.update(resources)
              .set({
                used: sql`GREATEST(0, ${resources.used} - ${entry.ftthSold || 0})`,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, ftthResource.id));
          }
        }
      });

      // Event-level lease/eb rollup
      if ((entry.leaseSold || 0) > 0 || (entry.ebSold || 0) > 0) {
        const allAssignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, entry.eventId));
        await db.update(events).set({
          leaseCompleted: allAssignments.reduce((s, a) => s + (a.leaseCompleted || 0), 0),
          ebCompleted: allAssignments.reduce((s, a) => s + (a.ebCompleted || 0), 0),
          updatedAt: new Date(),
        }).where(eq(events.id, entry.eventId));
      }

      await db.insert(auditLogs).values({
        action: 'DELETE_EVENT_SALES',
        entityType: 'SALES',
        entityId: entry.id,
        performedBy: actor,
        details: {
          eventId: entry.eventId,
          reason: input.reason,
          simsSold: entry.simsSold,
          ftthSold: entry.ftthSold,
          leaseSold: entry.leaseSold,
          ebSold: entry.ebSold,
        },
      });

      return { success: true, entryId: entry.id };
    }),

  // Append SIM activations to an existing entry without changing sold counts.
  // Useful when SIMs were sold first and activated later.
  activateSimsForEntry: authedProcedure
    .input(z.object({
      entryId: z.string().uuid(),
      lines: z.array(z.object({
        mobileNumber: z.string().regex(/^[6-9]\d{9}$/, 'Mobile number must be 10 digits starting with 6-9'),
        simSerialNumber: z.string().optional(),
        customerName: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
      })).min(1, 'At least one mobile number is required'),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.employeeId;
      const [entry] = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.id, input.entryId));
      if (!entry) throw new Error('Sales entry not found');
      if (entry.entryStatus !== 'active') {
        throw new Error(`Cannot add activations to ${entry.entryStatus} entry`);
      }
      if (entry.employeeId !== actor) {
        throw new Error('Only the entry creator can add activations');
      }

      const numbers = input.lines.map(l => l.mobileNumber);
      if (new Set(numbers).size !== numbers.length) {
        throw new Error('Duplicate mobile numbers in this activation batch.');
      }

      // Cross-event uniqueness against active entries
      const dup = await db.select({ n: simSaleLines.mobileNumber })
        .from(simSaleLines)
        .innerJoin(eventSalesEntries, eq(simSaleLines.entryId, eventSalesEntries.id))
        .where(and(
          eq(simSaleLines.eventId, entry.eventId),
          inArray(simSaleLines.mobileNumber, numbers),
          eq(eventSalesEntries.entryStatus, 'active')
        ));
      if (dup.length > 0) {
        throw new Error(`Mobile number(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
      }

      const newActivated = (entry.simsActivated || 0) + input.lines.length;
      if (newActivated > (entry.simsSold || 0)) {
        throw new Error(`Cannot activate ${input.lines.length} more SIMs. Sold=${entry.simsSold}, already activated=${entry.simsActivated}.`);
      }

      await db.transaction(async (tx) => {
        await tx.insert(simSaleLines).values(input.lines.map(l => ({
          entryId: entry.id,
          eventId: entry.eventId,
          employeeId: entry.employeeId,
          mobileNumber: l.mobileNumber,
          simSerialNumber: l.simSerialNumber,
          customerName: l.customerName,
          customerType: l.customerType ?? entry.customerType,
          isActivated: true,
        })));
        await tx.update(eventSalesEntries)
          .set({ simsActivated: newActivated, updatedAt: new Date() })
          .where(eq(eventSalesEntries.id, entry.id));
      });

      await db.insert(auditLogs).values({
        action: 'ACTIVATE_SIMS_FOR_ENTRY',
        entityType: 'SALES',
        entityId: entry.id,
        performedBy: actor,
        details: { eventId: entry.eventId, addedCount: input.lines.length, newSimsActivated: newActivated },
      });

      return { success: true, entryId: entry.id, simsActivated: newActivated };
    }),

  // Append FTTH activations to an existing entry without changing sold counts.
  activateFtthForEntry: authedProcedure
    .input(z.object({
      entryId: z.string().uuid(),
      lines: z.array(z.object({
        ftthId: z.string().min(1).max(50),
        customerName: z.string().optional(),
        customerContact: z.string().optional(),
        customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
        planName: z.string().optional(),
      })).min(1, 'At least one FTTH ID is required'),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.employeeId;
      const [entry] = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.id, input.entryId));
      if (!entry) throw new Error('Sales entry not found');
      if (entry.entryStatus !== 'active') {
        throw new Error(`Cannot add activations to ${entry.entryStatus} entry`);
      }
      if (entry.employeeId !== actor) {
        throw new Error('Only the entry creator can add activations');
      }

      const ids = input.lines.map(l => l.ftthId);
      if (new Set(ids).size !== ids.length) {
        throw new Error('Duplicate FTTH IDs in this activation batch.');
      }

      const dup = await db.select({ n: ftthSaleLines.ftthId })
        .from(ftthSaleLines)
        .innerJoin(eventSalesEntries, eq(ftthSaleLines.entryId, eventSalesEntries.id))
        .where(and(
          eq(ftthSaleLines.eventId, entry.eventId),
          inArray(ftthSaleLines.ftthId, ids),
          eq(eventSalesEntries.entryStatus, 'active')
        ));
      if (dup.length > 0) {
        throw new Error(`FTTH ID(s) already submitted for this event: ${dup.map(d => d.n).join(', ')}`);
      }

      const newActivated = (entry.ftthActivated || 0) + input.lines.length;
      if (newActivated > (entry.ftthSold || 0)) {
        throw new Error(`Cannot activate ${input.lines.length} more FTTH. Sold=${entry.ftthSold}, already activated=${entry.ftthActivated}.`);
      }

      await db.transaction(async (tx) => {
        await tx.insert(ftthSaleLines).values(input.lines.map(l => ({
          entryId: entry.id,
          eventId: entry.eventId,
          employeeId: entry.employeeId,
          ftthId: l.ftthId,
          customerName: l.customerName,
          customerContact: l.customerContact,
          customerType: l.customerType ?? entry.customerType,
          planName: l.planName,
          isActivated: true,
        })));
        await tx.update(eventSalesEntries)
          .set({ ftthActivated: newActivated, updatedAt: new Date() })
          .where(eq(eventSalesEntries.id, entry.id));
      });

      await db.insert(auditLogs).values({
        action: 'ACTIVATE_FTTH_FOR_ENTRY',
        entityType: 'SALES',
        entityId: entry.id,
        performedBy: actor,
        details: { eventId: entry.eventId, addedCount: input.lines.length, newFtthActivated: newActivated },
      });

      return { success: true, entryId: entry.id, ftthActivated: newActivated };
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
      let persNoToEmpIdMap = new Map<string, string>();
      if (allTeamPersNos.size > 0) {
        const persNoArr = [...allTeamPersNos];
        const empRows = await db.select({ id: employees.id, persNo: employees.persNo, name: employees.name })
          .from(employees)
          .where(inArray(employees.persNo, persNoArr));
        for (const row of empRows) {
          if (row.persNo) {
            persNoNameMap.set(row.persNo, row.name);
            persNoToEmpIdMap.set(row.persNo, row.id);
          }
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

        const eventAssigns = eventAssignmentsMap.get(event.id) || [];

        const assignByEmpId = new Map<string, typeof eventAssigns[0]>();
        for (const ea of eventAssigns) {
          assignByEmpId.set(ea.employeeId, ea);
        }

        const teamMembers = teamPersNos.map((pn, idx) => {
          const empId = persNoToEmpIdMap.get(pn);
          const memberAssignment = empId ? assignByEmpId.get(empId) : undefined;
          
          const memberTeamSize = teamPersNos.length || 1;
          const getMemberDistTarget = (total: number) => {
            const base = Math.floor(total / memberTeamSize);
            const remainder = total % memberTeamSize;
            return idx < remainder ? base + 1 : base;
          };

          return {
            persNo: pn,
            name: persNoNameMap.get(pn) || pn,
            targets: {
              sim: memberAssignment ? memberAssignment.simTarget : (eventHasSIM ? getMemberDistTarget(event.targetSim) : 0),
              ftth: memberAssignment ? memberAssignment.ftthTarget : (eventHasFTTH ? getMemberDistTarget(event.targetFtth) : 0),
              lease: memberAssignment ? memberAssignment.leaseTarget : (eventHasLease ? getMemberDistTarget(event.targetLease ?? 0) : 0),
              btsDown: memberAssignment ? memberAssignment.btsDownTarget : (eventHasBtsDown ? getMemberDistTarget(event.targetBtsDown ?? 0) : 0),
              routeFail: memberAssignment ? memberAssignment.routeFailTarget : (eventHasRouteFail ? getMemberDistTarget(event.targetRouteFail ?? 0) : 0),
              ftthDown: memberAssignment ? memberAssignment.ftthDownTarget : (eventHasFtthDown ? getMemberDistTarget(event.targetFtthDown ?? 0) : 0),
              ofcFail: memberAssignment ? memberAssignment.ofcFailTarget : (eventHasOfcFail ? getMemberDistTarget(event.targetOfcFail ?? 0) : 0),
              eb: memberAssignment ? memberAssignment.ebTarget : (eventHasEb ? getMemberDistTarget(event.targetEb ?? 0) : 0),
            },
            progress: {
              simSold: memberAssignment?.simSold ?? 0,
              ftthSold: memberAssignment?.ftthSold ?? 0,
              lease: memberAssignment?.leaseCompleted ?? 0,
              btsDown: memberAssignment?.btsDownCompleted ?? 0,
              routeFail: memberAssignment?.routeFailCompleted ?? 0,
              ftthDown: memberAssignment?.ftthDownCompleted ?? 0,
              ofcFail: memberAssignment?.ofcFailCompleted ?? 0,
              eb: memberAssignment?.ebCompleted ?? 0,
            },
          };
        });

        if (isCreator) {
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
        const myLeaseTarget = assignment
          ? (assignment.leaseTarget ?? 0)
          : (eventHasLease ? getDistributedTarget(event.targetLease ?? 0) : 0);
        const myBtsDownTarget = assignment
          ? (assignment.btsDownTarget ?? 0)
          : (eventHasBtsDown ? getDistributedTarget(event.targetBtsDown ?? 0) : 0);
        const myRouteFailTarget = assignment
          ? (assignment.routeFailTarget ?? 0)
          : (eventHasRouteFail ? getDistributedTarget(event.targetRouteFail ?? 0) : 0);
        const myFtthDownTarget = assignment
          ? (assignment.ftthDownTarget ?? 0)
          : (eventHasFtthDown ? getDistributedTarget(event.targetFtthDown ?? 0) : 0);
        const myOfcFailTarget = assignment
          ? (assignment.ofcFailTarget ?? 0)
          : (eventHasOfcFail ? getDistributedTarget(event.targetOfcFail ?? 0) : 0);
        const myEbTarget = assignment
          ? (assignment.ebTarget ?? 0)
          : (eventHasEb ? getDistributedTarget(event.targetEb ?? 0) : 0);
        
        const hasSIM = assignment ? assignment.simTarget > 0 : eventHasSIM;
        const hasFTTH = assignment ? assignment.ftthTarget > 0 : eventHasFTTH;
        const hasLease = assignment ? myLeaseTarget > 0 : eventHasLease;
        const hasBtsDown = assignment ? myBtsDownTarget > 0 : eventHasBtsDown;
        const hasRouteFail = assignment ? myRouteFailTarget > 0 : eventHasRouteFail;
        const hasFtthDown = assignment ? myFtthDownTarget > 0 : eventHasFtthDown;
        const hasOfcFail = assignment ? myOfcFailTarget > 0 : eventHasOfcFail;
        const hasEb = assignment ? myEbTarget > 0 : eventHasEb;
        
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
            lease: assignment?.leaseCompleted ?? 0,
            eb: assignment?.ebCompleted ?? 0,
            btsDown: assignment?.btsDownCompleted ?? 0,
            routeFail: assignment?.routeFailCompleted ?? 0,
            ftthDown: assignment?.ftthDownCompleted ?? 0,
            ofcFail: assignment?.ofcFailCompleted ?? 0,
          },
          maintenanceProgress: {
            // Per-employee when assigned, fall back to event rollup otherwise
            lease: assignment ? (assignment.leaseCompleted ?? 0) : (event.leaseCompleted ?? 0),
            leaseTarget: myLeaseTarget,
            btsDown: assignment ? (assignment.btsDownCompleted ?? 0) : (event.btsDownCompleted ?? 0),
            btsDownTarget: myBtsDownTarget,
            routeFail: assignment ? (assignment.routeFailCompleted ?? 0) : (event.routeFailCompleted ?? 0),
            routeFailTarget: myRouteFailTarget,
            ftthDown: assignment ? (assignment.ftthDownCompleted ?? 0) : (event.ftthDownCompleted ?? 0),
            ftthDownTarget: myFtthDownTarget,
            ofcFail: assignment ? (assignment.ofcFailCompleted ?? 0) : (event.ofcFailCompleted ?? 0),
            ofcFailTarget: myOfcFailTarget,
            eb: assignment ? (assignment.ebCompleted ?? 0) : (event.ebCompleted ?? 0),
            ebTarget: myEbTarget,
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
              (assignment?.leaseCompleted ?? 0) > 0 ||
              (assignment?.btsDownCompleted ?? 0) > 0 ||
              (assignment?.routeFailCompleted ?? 0) > 0 ||
              (assignment?.ftthDownCompleted ?? 0) > 0 ||
              (assignment?.ofcFailCompleted ?? 0) > 0 ||
              (assignment?.ebCompleted ?? 0) > 0;
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
