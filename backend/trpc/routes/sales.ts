import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, salesReports, auditLogs, events, employees, eventAssignments, employeeMaster, financeCollectionEntries } from "@/backend/db";

// Helper function to get all subordinate IDs (copied from events.ts for consistency)
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
    const currentPersNos = [...persNosToProcess];
    persNosToProcess.length = 0;
    
    for (const persNo of currentPersNos) {
      if (processedPersNos.has(persNo)) continue;
      processedPersNos.add(persNo);
      
      const subordinates = await db.select({
        persNo: employeeMaster.persNo,
      }).from(employeeMaster)
        .where(eq(employeeMaster.reportingPersNo, persNo));
      
      for (const sub of subordinates) {
        if (!sub.persNo) continue;
        const subEmployee = await db.select({ id: employees.id })
          .from(employees)
          .where(eq(employees.persNo, sub.persNo))
          .limit(1);
        
        if (subEmployee[0]) {
          allSubordinateIds.push(subEmployee[0].id);
        }
        persNosToProcess.push(sub.persNo);
      }
    }
    depth++;
  }
  
  return allSubordinateIds;
}

export const salesRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      eventId: z.string().uuid().optional(),
      salesStaffId: z.string().uuid().optional(),
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all sales reports", input);
      const results = await db.select({
        id: salesReports.id,
        eventId: salesReports.eventId,
        salesStaffId: salesReports.salesStaffId,
        simsSold: salesReports.simsSold,
        simsActivated: salesReports.simsActivated,
        ftthLeads: salesReports.ftthLeads,
        ftthInstalled: salesReports.ftthInstalled,
        customerType: salesReports.customerType,
        photos: salesReports.photos,
        gpsLatitude: salesReports.gpsLatitude,
        gpsLongitude: salesReports.gpsLongitude,
        remarks: salesReports.remarks,
        synced: salesReports.synced,
        status: salesReports.status,
        reviewedBy: salesReports.reviewedBy,
        reviewedAt: salesReports.reviewedAt,
        reviewRemarks: salesReports.reviewRemarks,
        createdAt: salesReports.createdAt,
        updatedAt: salesReports.updatedAt,
        salesStaffName: employees.name,
        eventName: events.name,
      })
      .from(salesReports)
      .leftJoin(employees, eq(salesReports.salesStaffId, employees.id))
      .leftJoin(events, eq(salesReports.eventId, events.id))
      .orderBy(desc(salesReports.createdAt));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching sales report by id:", input.id);
      const result = await db.select().from(salesReports).where(eq(salesReports.id, input.id));
      return result[0] || null;
    }),

  getByEvent: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching sales reports by event:", input.eventId);
      const result = await db.select().from(salesReports)
        .where(eq(salesReports.eventId, input.eventId))
        .orderBy(desc(salesReports.createdAt));
      return result;
    }),

  getByStaff: publicProcedure
    .input(z.object({ salesStaffId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching sales reports by staff:", input.salesStaffId);
      const result = await db.select().from(salesReports)
        .where(eq(salesReports.salesStaffId, input.salesStaffId))
        .orderBy(desc(salesReports.createdAt));
      return result;
    }),

  getByType: publicProcedure
    .input(z.object({ 
      type: z.enum(['sim', 'ftth']),
      employeeId: z.string().uuid(),
      limit: z.number().min(1).max(500).optional().default(100)
    }))
    .query(async ({ input }) => {
      console.log("Fetching sales data by type:", input.type, "for employee:", input.employeeId);
      
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        return [];
      }
      
      const userRole = employee[0].role;
      const userPersNo = employee[0].persNo;
      const isAdmin = userRole === 'ADMIN';
      
      // Build condition based on type
      const typeCondition = input.type === 'sim' 
        ? sql`${eventAssignments.simSold} > 0`
        : sql`${eventAssignments.ftthSold} > 0`;
      
      // Get subordinate IDs for managers
      const subordinateIds = await getAllSubordinateIds(input.employeeId);
      const allVisibleIds = [input.employeeId, ...subordinateIds];
      
      // Get subordinates' persNos for team assignment visibility
      let allVisiblePersNos: string[] = userPersNo ? [userPersNo] : [];
      if (subordinateIds.length > 0) {
        const subEmployees = await db.select({ persNo: employees.persNo })
          .from(employees)
          .where(inArray(employees.id, subordinateIds));
        allVisiblePersNos = [...allVisiblePersNos, ...subEmployees.map(e => e.persNo).filter(Boolean) as string[]];
      }
      
      // For admins, show all; for others, show events they created, assigned to, or subordinates'
      let visibilityCondition;
      if (isAdmin) {
        visibilityCondition = sql`1=1`;
      } else {
        // Build team check condition
        const teamCheckCondition = allVisiblePersNos.length > 0
          ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem IN (${sql.raw(allVisiblePersNos.map(p => `'${p}'`).join(','))}))`
          : sql`false`;
        
        // Show assignments from events created by user/subordinates or where user/subordinates are in assigned team
        visibilityCondition = sql`(
          ${events.createdBy} IN (${sql.raw(allVisibleIds.map(id => `'${id}'`).join(','))})
          OR ${events.assignedTo} IN (${sql.raw(allVisibleIds.map(id => `'${id}'`).join(','))})
          OR ${teamCheckCondition}
        )`;
      }
      
      const results = await db.select({
        id: eventAssignments.id,
        eventId: eventAssignments.eventId,
        salesStaffId: eventAssignments.employeeId,
        simsSold: eventAssignments.simSold,
        simsActivated: sql<number>`0`.as('sims_activated'),
        activatedMobileNumbers: sql<string[]>`ARRAY[]::text[]`.as('activated_mobile_numbers'),
        ftthLeads: eventAssignments.ftthSold,
        ftthInstalled: sql<number>`0`.as('ftth_installed'),
        activatedFtthIds: sql<string[]>`ARRAY[]::text[]`.as('activated_ftth_ids'),
        customerType: sql<string>`'B2C'`.as('customer_type'),
        status: eventAssignments.submissionStatus,
        createdAt: eventAssignments.assignedAt,
        remarks: sql<string>`''`.as('remarks'),
        salesStaffName: employees.name,
        salesStaffDesignation: employees.designation,
        salesStaffCircle: employees.circle,
        eventName: events.name,
        eventLocation: events.location,
        eventCircle: events.circle,
        eventStartDate: events.startDate,
        eventEndDate: events.endDate,
        simTarget: eventAssignments.simTarget,
        ftthTarget: eventAssignments.ftthTarget,
      })
      .from(eventAssignments)
      .leftJoin(employees, eq(eventAssignments.employeeId, employees.id))
      .leftJoin(events, eq(eventAssignments.eventId, events.id))
      .where(and(typeCondition, visibilityCondition))
      .orderBy(desc(eventAssignments.assignedAt))
      .limit(input.limit);
      
      return results;
    }),

  create: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      salesStaffId: z.string().uuid(),
      simsSold: z.number().min(0),
      simsActivated: z.number().min(0),
      ftthLeads: z.number().min(0),
      ftthInstalled: z.number().min(0),
      customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']),
      photos: z.array(z.string()).optional(),
      gpsLatitude: z.string().optional(),
      gpsLongitude: z.string().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating sales report for event:", input.eventId);
      const result = await db.insert(salesReports).values({
        eventId: input.eventId,
        salesStaffId: input.salesStaffId,
        simsSold: input.simsSold,
        simsActivated: input.simsActivated,
        ftthLeads: input.ftthLeads,
        ftthInstalled: input.ftthInstalled,
        customerType: input.customerType,
        photos: input.photos || [],
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        remarks: input.remarks,
      }).returning();

      await db.insert(auditLogs).values({
        action: 'CREATE_SALES_REPORT',
        entityType: 'SALES',
        entityId: result[0].id,
        performedBy: input.salesStaffId,
        details: { 
          eventId: input.eventId,
          simsSold: input.simsSold,
          ftthInstalled: input.ftthInstalled,
        },
      });

      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      simsSold: z.number().min(0).optional(),
      simsActivated: z.number().min(0).optional(),
      ftthLeads: z.number().min(0).optional(),
      ftthInstalled: z.number().min(0).optional(),
      customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']).optional(),
      photos: z.array(z.string()).optional(),
      remarks: z.string().optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating sales report:", input.id);
      const { id, updatedBy, ...updateData } = input;
      
      const result = await db.update(salesReports)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(salesReports.id, id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_SALES_REPORT',
        entityType: 'SALES',
        entityId: id,
        performedBy: updatedBy,
        details: updateData,
      });

      return result[0];
    }),

  getEventSummary: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching event sales summary:", input.eventId);
      const reports = await db.select().from(salesReports)
        .where(eq(salesReports.eventId, input.eventId));

      const summary = {
        totalSimsSold: 0,
        totalSimsActivated: 0,
        totalFtthLeads: 0,
        totalFtthInstalled: 0,
        reportCount: reports.length,
      };

      for (const report of reports) {
        summary.totalSimsSold += report.simsSold;
        summary.totalSimsActivated += report.simsActivated;
        summary.totalFtthLeads += report.ftthLeads;
        summary.totalFtthInstalled += report.ftthInstalled;
      }

      return summary;
    }),

  getStaffSummary: publicProcedure
    .input(z.object({ salesStaffId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching staff sales summary:", input.salesStaffId);
      const reports = await db.select().from(salesReports)
        .where(eq(salesReports.salesStaffId, input.salesStaffId));

      const summary = {
        totalSimsSold: 0,
        totalSimsActivated: 0,
        totalFtthLeads: 0,
        totalFtthInstalled: 0,
        reportCount: reports.length,
      };

      for (const report of reports) {
        summary.totalSimsSold += report.simsSold;
        summary.totalSimsActivated += report.simsActivated;
        summary.totalFtthLeads += report.ftthLeads;
        summary.totalFtthInstalled += report.ftthInstalled;
      }

      return summary;
    }),

  getDashboardStats: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching dashboard stats", input);
      const reports = await db.select().from(salesReports);

      const stats = {
        totalSimsSold: 0,
        totalSimsActivated: 0,
        totalFtthLeads: 0,
        totalFtthInstalled: 0,
        totalReports: reports.length,
      };

      for (const report of reports) {
        stats.totalSimsSold += report.simsSold;
        stats.totalSimsActivated += report.simsActivated;
        stats.totalFtthLeads += report.ftthLeads;
        stats.totalFtthInstalled += report.ftthInstalled;
      }

      return stats;
    }),

  getPendingForReview: publicProcedure
    .input(z.object({
      reviewerId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching pending sales reports for reviewer:", input.reviewerId);
      const results = await db.select({
        id: salesReports.id,
        eventId: salesReports.eventId,
        salesStaffId: salesReports.salesStaffId,
        simsSold: salesReports.simsSold,
        simsActivated: salesReports.simsActivated,
        ftthLeads: salesReports.ftthLeads,
        ftthInstalled: salesReports.ftthInstalled,
        customerType: salesReports.customerType,
        photos: salesReports.photos,
        gpsLatitude: salesReports.gpsLatitude,
        gpsLongitude: salesReports.gpsLongitude,
        remarks: salesReports.remarks,
        synced: salesReports.synced,
        status: salesReports.status,
        reviewedBy: salesReports.reviewedBy,
        reviewedAt: salesReports.reviewedAt,
        reviewRemarks: salesReports.reviewRemarks,
        createdAt: salesReports.createdAt,
        updatedAt: salesReports.updatedAt,
        salesStaffName: employees.name,
        eventName: events.name,
      })
      .from(salesReports)
      .leftJoin(employees, eq(salesReports.salesStaffId, employees.id))
      .leftJoin(events, eq(salesReports.eventId, events.id))
      .where(eq(salesReports.status, 'pending'))
      .orderBy(desc(salesReports.createdAt));
      return results;
    }),

  approve: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      reviewerId: z.string().uuid(),
      reviewRemarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Approving sales report:", input.id);
      const result = await db.update(salesReports)
        .set({
          status: 'approved',
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
          reviewRemarks: input.reviewRemarks,
          updatedAt: new Date(),
        })
        .where(eq(salesReports.id, input.id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'APPROVE_SALES_REPORT',
        entityType: 'SALES',
        entityId: input.id,
        performedBy: input.reviewerId,
        details: { reviewRemarks: input.reviewRemarks },
      });

      return result[0];
    }),

  reject: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      reviewerId: z.string().uuid(),
      reviewRemarks: z.string(),
    }))
    .mutation(async ({ input }) => {
      console.log("Rejecting sales report:", input.id);
      const result = await db.update(salesReports)
        .set({
          status: 'rejected',
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
          reviewRemarks: input.reviewRemarks,
          updatedAt: new Date(),
        })
        .where(eq(salesReports.id, input.id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'REJECT_SALES_REPORT',
        entityType: 'SALES',
        entityId: input.id,
        performedBy: input.reviewerId,
        details: { reviewRemarks: input.reviewRemarks },
      });

      return result[0];
    }),

  bulkApprove: publicProcedure
    .input(z.object({
      ids: z.array(z.string().uuid()),
      reviewerId: z.string().uuid(),
      reviewRemarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Bulk approving sales reports:", input.ids);
      const result = await db.update(salesReports)
        .set({
          status: 'approved',
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
          reviewRemarks: input.reviewRemarks || 'Bulk approved',
          updatedAt: new Date(),
        })
        .where(inArray(salesReports.id, input.ids))
        .returning();

      for (const report of result) {
        await db.insert(auditLogs).values({
          action: 'APPROVE_SALES_REPORT',
          entityType: 'SALES',
          entityId: report.id,
          performedBy: input.reviewerId,
          details: { reviewRemarks: input.reviewRemarks, bulkApproval: true },
        });
      }

      return result;
    }),

  getFinanceCollections: publicProcedure
    .input(z.object({ 
      employeeId: z.string().uuid(),
      financeType: z.string().optional(),
      limit: z.number().min(1).max(500).optional().default(100)
    }))
    .query(async ({ input }) => {
      console.log("Fetching finance collections for employee:", input.employeeId);
      
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        return [];
      }
      
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';
      
      const subordinateIds = await getAllSubordinateIds(input.employeeId);
      const allVisibleIds = [input.employeeId, ...subordinateIds];
      
      let whereConditions = isAdmin 
        ? sql`1=1`
        : inArray(financeCollectionEntries.employeeId, allVisibleIds);
      
      if (input.financeType) {
        whereConditions = and(whereConditions, eq(financeCollectionEntries.financeType, input.financeType)) || whereConditions;
      }
      
      const results = await db.select({
        id: financeCollectionEntries.id,
        eventId: financeCollectionEntries.eventId,
        employeeId: financeCollectionEntries.employeeId,
        financeType: financeCollectionEntries.financeType,
        amountCollected: financeCollectionEntries.amountCollected,
        paymentMode: financeCollectionEntries.paymentMode,
        transactionReference: financeCollectionEntries.transactionReference,
        customerName: financeCollectionEntries.customerName,
        customerContact: financeCollectionEntries.customerContact,
        remarks: financeCollectionEntries.remarks,
        createdAt: financeCollectionEntries.createdAt,
        employeeName: employees.name,
        employeeDesignation: employees.designation,
        employeeCircle: employees.circle,
        eventName: events.name,
        eventLocation: events.location,
        eventStartDate: events.startDate,
        eventEndDate: events.endDate,
      })
      .from(financeCollectionEntries)
      .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
      .leftJoin(events, eq(financeCollectionEntries.eventId, events.id))
      .where(whereConditions)
      .orderBy(desc(financeCollectionEntries.createdAt))
      .limit(input.limit);
      
      return results;
    }),

  getFinanceSummary: publicProcedure
    .input(z.object({ 
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching finance summary for employee:", input.employeeId);
      
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        return { totalCollected: 0, totalTarget: 0, entries: 0, byType: {} };
      }
      
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';
      
      const subordinateIds = await getAllSubordinateIds(input.employeeId);
      const allVisibleIds = [input.employeeId, ...subordinateIds];
      
      const collectionConditions = isAdmin 
        ? sql`1=1`
        : inArray(financeCollectionEntries.employeeId, allVisibleIds);
      
      const results = await db.select({
        financeType: financeCollectionEntries.financeType,
        totalAmount: sql<number>`SUM(${financeCollectionEntries.amountCollected})`.as('total_amount'),
        entryCount: sql<number>`COUNT(*)`.as('entry_count'),
      })
      .from(financeCollectionEntries)
      .where(collectionConditions)
      .groupBy(financeCollectionEntries.financeType);
      
      const userPersNo = employee[0].persNo;
      let allVisiblePersNos: string[] = userPersNo ? [userPersNo] : [];
      if (subordinateIds.length > 0) {
        const subEmployees = await db.select({ persNo: employees.persNo })
          .from(employees)
          .where(inArray(employees.id, subordinateIds));
        allVisiblePersNos = [...allVisiblePersNos, ...subEmployees.map(e => e.persNo).filter(Boolean) as string[]];
      }
      
      let eventVisibilityCondition;
      if (isAdmin) {
        eventVisibilityCondition = sql`1=1`;
      } else {
        const teamCheckCondition = allVisiblePersNos.length > 0
          ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem = ANY(${allVisiblePersNos}))`
          : sql`false`;
        
        eventVisibilityCondition = sql`(
          ${inArray(events.createdBy, allVisibleIds)}
          OR ${inArray(events.assignedTo, allVisibleIds)}
          OR ${teamCheckCondition}
        )`;
      }
      
      const eventTargets = await db.select({
        targetFinLc: sql<number>`SUM(COALESCE(${events.targetFinLc}, 0))`,
        targetFinLlFtth: sql<number>`SUM(COALESCE(${events.targetFinLlFtth}, 0))`,
        targetFinTower: sql<number>`SUM(COALESCE(${events.targetFinTower}, 0))`,
        targetFinGsmPostpaid: sql<number>`SUM(COALESCE(${events.targetFinGsmPostpaid}, 0))`,
        targetFinRentBuilding: sql<number>`SUM(COALESCE(${events.targetFinRentBuilding}, 0))`,
      })
      .from(events)
      .where(eventVisibilityCondition);
      
      const targets = eventTargets[0] || {};
      const totalTarget = (Number(targets.targetFinLc) || 0) + 
                          (Number(targets.targetFinLlFtth) || 0) + 
                          (Number(targets.targetFinTower) || 0) + 
                          (Number(targets.targetFinGsmPostpaid) || 0) + 
                          (Number(targets.targetFinRentBuilding) || 0);
      
      const byType: Record<string, { totalCollected: number; entries: number; target: number }> = {
        FIN_LC: { totalCollected: 0, entries: 0, target: Number(targets.targetFinLc) || 0 },
        FIN_LL_FTTH: { totalCollected: 0, entries: 0, target: Number(targets.targetFinLlFtth) || 0 },
        FIN_TOWER: { totalCollected: 0, entries: 0, target: Number(targets.targetFinTower) || 0 },
        FIN_GSM_POSTPAID: { totalCollected: 0, entries: 0, target: Number(targets.targetFinGsmPostpaid) || 0 },
        FIN_RENT_BUILDING: { totalCollected: 0, entries: 0, target: Number(targets.targetFinRentBuilding) || 0 },
      };
      
      let totalCollected = 0;
      let totalEntries = 0;
      
      for (const r of results) {
        if (byType[r.financeType]) {
          byType[r.financeType].totalCollected = Number(r.totalAmount) || 0;
          byType[r.financeType].entries = Number(r.entryCount) || 0;
        }
        totalCollected += Number(r.totalAmount) || 0;
        totalEntries += Number(r.entryCount) || 0;
      }
      
      return { totalCollected, totalTarget, entries: totalEntries, byType };
    }),
});
