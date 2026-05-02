import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql, inArray, gte, lte, sum, count } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, salesReports, auditLogs, events, employees, eventAssignments, employeeMaster, financeCollectionEntries, eventSalesEntries, maintenanceEntries } from "@/backend/db";

function getVisibleEmployeeIdsSubquery(persNo: string) {
  return sql`(
    SELECT e.id FROM employees e WHERE e.pers_no = ${persNo}
    UNION
    SELECT e.id FROM (
      WITH RECURSIVE subordinates AS (
        SELECT pers_no FROM employee_master WHERE reporting_pers_no = ${persNo}
        UNION ALL
        SELECT em.pers_no FROM employee_master em
        INNER JOIN subordinates s ON em.reporting_pers_no = s.pers_no
      )
      SELECT pers_no FROM subordinates
    ) sub
    INNER JOIN employees e ON e.pers_no = sub.pers_no
  )`;
}

function getVisiblePersNosSubquery(persNo: string) {
  return sql`(
    SELECT ${persNo}
    UNION
    SELECT pers_no FROM (
      WITH RECURSIVE subordinates AS (
        SELECT pers_no FROM employee_master WHERE reporting_pers_no = ${persNo}
        UNION ALL
        SELECT em.pers_no FROM employee_master em
        INNER JOIN subordinates s ON em.reporting_pers_no = s.pers_no
      )
      SELECT pers_no FROM subordinates
    ) sub
  )`;
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
      
      const typeCondition = input.type === 'sim' 
        ? sql`${eventAssignments.simTarget} > 0`
        : sql`${eventAssignments.ftthTarget} > 0`;
      
      let visibilityCondition;
      if (isAdmin) {
        visibilityCondition = sql`1=1`;
      } else if (userPersNo) {
        const idsSubquery = getVisibleEmployeeIdsSubquery(userPersNo);
        const persNosSubquery = getVisiblePersNosSubquery(userPersNo);
        visibilityCondition = sql`(
          ${events.createdBy} IN ${idsSubquery}
          OR ${events.assignedTo} IN ${idsSubquery}
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem IN ${persNosSubquery})
        )`;
      } else {
        visibilityCondition = sql`1=0`;
      }
      
      const results = await db.select({
        id: eventAssignments.id,
        eventId: eventAssignments.eventId,
        salesStaffId: eventAssignments.employeeId,
        simsSold: sql<number>`COALESCE((SELECT SUM(ese.sims_sold) FROM event_sales_entries ese WHERE ese.event_id = ${eventAssignments.eventId} AND ese.employee_id = ${eventAssignments.employeeId}), 0)::integer`.as('actual_sims_sold'),
        simsActivated: sql<number>`COALESCE((SELECT SUM(ese.sims_activated) FROM event_sales_entries ese WHERE ese.event_id = ${eventAssignments.eventId} AND ese.employee_id = ${eventAssignments.employeeId}), 0)::integer`.as('sims_activated'),
        activatedMobileNumbers: sql<string[]>`ARRAY[]::text[]`.as('activated_mobile_numbers'),
        ftthLeads: sql<number>`COALESCE((SELECT SUM(ese.ftth_sold) FROM event_sales_entries ese WHERE ese.event_id = ${eventAssignments.eventId} AND ese.employee_id = ${eventAssignments.employeeId}), 0)::integer`.as('actual_ftth_sold'),
        ftthInstalled: sql<number>`COALESCE((SELECT SUM(ese.ftth_activated) FROM event_sales_entries ese WHERE ese.event_id = ${eventAssignments.eventId} AND ese.employee_id = ${eventAssignments.employeeId}), 0)::integer`.as('ftth_installed'),
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
      const userPersNo = employee[0].persNo;
      const isAdmin = userRole === 'ADMIN';
      
      let baseCondition;
      if (isAdmin) {
        baseCondition = sql`1=1`;
      } else if (userPersNo) {
        const idsSubquery = getVisibleEmployeeIdsSubquery(userPersNo);
        baseCondition = sql`${financeCollectionEntries.employeeId} IN ${idsSubquery}`;
      } else {
        baseCondition = sql`1=0`;
      }
      
      let whereConditions: any = baseCondition;
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
        approvalStatus: financeCollectionEntries.approvalStatus,
        reviewedBy: financeCollectionEntries.reviewedBy,
        reviewedAt: financeCollectionEntries.reviewedAt,
        reviewRemarks: financeCollectionEntries.reviewRemarks,
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
      const userPersNo = employee[0].persNo;
      const isAdmin = userRole === 'ADMIN';
      
      let collectionConditions;
      if (isAdmin) {
        collectionConditions = sql`1=1`;
      } else if (userPersNo) {
        const idsSubquery = getVisibleEmployeeIdsSubquery(userPersNo);
        collectionConditions = sql`${financeCollectionEntries.employeeId} IN ${idsSubquery}`;
      } else {
        collectionConditions = sql`1=0`;
      }
      
      // Approved totals (verified money) — used for "totalCollected" displayed to users
      const approvedResults = await db.select({
        financeType: financeCollectionEntries.financeType,
        totalAmount: sql<number>`SUM(${financeCollectionEntries.amountCollected})`.as('total_amount'),
        entryCount: sql<number>`COUNT(*)`.as('entry_count'),
      })
      .from(financeCollectionEntries)
      .where(and(collectionConditions, eq(financeCollectionEntries.approvalStatus, 'approved')))
      .groupBy(financeCollectionEntries.financeType);
      
      // Pending totals (awaiting manager review) — exposed separately for UI breakdown
      const pendingResults = await db.select({
        financeType: financeCollectionEntries.financeType,
        totalAmount: sql<number>`SUM(${financeCollectionEntries.amountCollected})`.as('total_amount'),
        entryCount: sql<number>`COUNT(*)`.as('entry_count'),
      })
      .from(financeCollectionEntries)
      .where(and(collectionConditions, eq(financeCollectionEntries.approvalStatus, 'pending')))
      .groupBy(financeCollectionEntries.financeType);
      
      const results = approvedResults;
      
      let eventVisibilityCondition;
      if (isAdmin) {
        eventVisibilityCondition = sql`1=1`;
      } else if (userPersNo) {
        const idsSubquery = getVisibleEmployeeIdsSubquery(userPersNo);
        const persNosSubquery = getVisiblePersNosSubquery(userPersNo);
        eventVisibilityCondition = sql`(
          ${events.createdBy} IN ${idsSubquery}
          OR ${events.assignedTo} IN ${idsSubquery}
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${events.assignedTeam}::jsonb) AS elem WHERE elem IN ${persNosSubquery})
        )`;
      } else {
        eventVisibilityCondition = sql`1=0`;
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
      
      const byType: Record<string, { totalCollected: number; entries: number; target: number; pendingAmount: number; pendingEntries: number }> = {
        FIN_LC: { totalCollected: 0, entries: 0, target: Number(targets.targetFinLc) || 0, pendingAmount: 0, pendingEntries: 0 },
        FIN_LL_FTTH: { totalCollected: 0, entries: 0, target: Number(targets.targetFinLlFtth) || 0, pendingAmount: 0, pendingEntries: 0 },
        FIN_TOWER: { totalCollected: 0, entries: 0, target: Number(targets.targetFinTower) || 0, pendingAmount: 0, pendingEntries: 0 },
        FIN_GSM_POSTPAID: { totalCollected: 0, entries: 0, target: Number(targets.targetFinGsmPostpaid) || 0, pendingAmount: 0, pendingEntries: 0 },
        FIN_RENT_BUILDING: { totalCollected: 0, entries: 0, target: Number(targets.targetFinRentBuilding) || 0, pendingAmount: 0, pendingEntries: 0 },
      };
      
      let totalCollected = 0;
      let totalEntries = 0;
      let totalPending = 0;
      let totalPendingEntries = 0;
      
      for (const r of results) {
        if (byType[r.financeType]) {
          byType[r.financeType].totalCollected = Number(r.totalAmount) || 0;
          byType[r.financeType].entries = Number(r.entryCount) || 0;
        }
        totalCollected += Number(r.totalAmount) || 0;
        totalEntries += Number(r.entryCount) || 0;
      }
      
      for (const r of pendingResults) {
        if (byType[r.financeType]) {
          byType[r.financeType].pendingAmount = Number(r.totalAmount) || 0;
          byType[r.financeType].pendingEntries = Number(r.entryCount) || 0;
        }
        totalPending += Number(r.totalAmount) || 0;
        totalPendingEntries += Number(r.entryCount) || 0;
      }
      
      return { totalCollected, totalTarget, entries: totalEntries, byType, totalPending, totalPendingEntries };
    }),

  getSalesAnalytics: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      circle: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }
      
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';
      
      const buildConditions = () => {
        const conditions: any[] = [];
        
        if (input.startDate) {
          conditions.push(gte(eventSalesEntries.createdAt, new Date(input.startDate)));
        }
        if (input.endDate) {
          conditions.push(lte(eventSalesEntries.createdAt, new Date(input.endDate)));
        }
        if (input.circle) {
          conditions.push(eq(employees.circle, input.circle));
        }
        if (!isAdmin && employee[0].persNo) {
          const subquery = getVisibleEmployeeIdsSubquery(employee[0].persNo);
          conditions.push(sql`${eventSalesEntries.employeeId} IN ${subquery}`);
        } else if (!isAdmin) {
          conditions.push(sql`1=0`);
        }
        
        return conditions;
      };
      
      const conditions = buildConditions();
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      const totalsResult = await db.select({
        totalSimsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        totalSimsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        totalFtthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        totalFtthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
        totalLeaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        totalEbSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        totalEntries: sql<number>`COUNT(*)`,
      })
      .from(eventSalesEntries)
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .where(whereClause);
      
      const totals = totalsResult[0];
      const simsSold = Number(totals?.totalSimsSold) || 0;
      const simsActivated = Number(totals?.totalSimsActivated) || 0;
      const ftthSold = Number(totals?.totalFtthSold) || 0;
      const ftthActivated = Number(totals?.totalFtthActivated) || 0;
      const leaseSold = Number(totals?.totalLeaseSold) || 0;
      const ebSold = Number(totals?.totalEbSold) || 0;
      
      const byEmployeeResult = await db.select({
        id: eventSalesEntries.employeeId,
        name: employees.name,
        designation: employees.designation,
        circle: employees.circle,
        simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        simsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        ftthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
        leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        entries: sql<number>`COUNT(*)`,
      })
      .from(eventSalesEntries)
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .where(whereClause)
      .groupBy(eventSalesEntries.employeeId, employees.name, employees.designation, employees.circle)
      .orderBy(sql`SUM(${eventSalesEntries.simsSold}) + SUM(${eventSalesEntries.ftthSold}) + SUM(${eventSalesEntries.leaseSold}) + SUM(${eventSalesEntries.ebSold}) DESC`)
      .limit(20);
      
      const byEventResult = await db.select({
        id: eventSalesEntries.eventId,
        name: events.name,
        category: events.category,
        simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        simsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        ftthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
        leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        entries: sql<number>`COUNT(*)`,
      })
      .from(eventSalesEntries)
      .leftJoin(events, eq(eventSalesEntries.eventId, events.id))
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .where(whereClause)
      .groupBy(eventSalesEntries.eventId, events.name, events.category)
      .orderBy(sql`SUM(${eventSalesEntries.simsSold}) + SUM(${eventSalesEntries.ftthSold}) + SUM(${eventSalesEntries.leaseSold}) + SUM(${eventSalesEntries.ebSold}) DESC`)
      .limit(20);
      
      const recentEntries = await db.select({
        id: eventSalesEntries.id,
        eventId: eventSalesEntries.eventId,
        employeeId: eventSalesEntries.employeeId,
        simsSold: eventSalesEntries.simsSold,
        simsActivated: eventSalesEntries.simsActivated,
        ftthSold: eventSalesEntries.ftthSold,
        ftthActivated: eventSalesEntries.ftthActivated,
        customerType: eventSalesEntries.customerType,
        createdAt: eventSalesEntries.createdAt,
        employeeName: employees.name,
        eventName: events.name,
      })
      .from(eventSalesEntries)
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .leftJoin(events, eq(eventSalesEntries.eventId, events.id))
      .where(whereClause)
      .orderBy(desc(eventSalesEntries.createdAt))
      .limit(30);
      
      const byEmployee = byEmployeeResult.map(e => ({
        id: e.id || '',
        name: e.name || 'Unknown',
        designation: e.designation || '',
        circle: e.circle || '',
        simsSold: Number(e.simsSold) || 0,
        simsActivated: Number(e.simsActivated) || 0,
        ftthSold: Number(e.ftthSold) || 0,
        ftthActivated: Number(e.ftthActivated) || 0,
        leaseSold: Number(e.leaseSold) || 0,
        ebSold: Number(e.ebSold) || 0,
        entries: Number(e.entries) || 0,
      }));
      
      const byEvent = byEventResult.map(e => ({
        id: e.id || '',
        name: e.name || 'Unknown',
        category: e.category || '',
        simsSold: Number(e.simsSold) || 0,
        simsActivated: Number(e.simsActivated) || 0,
        ftthSold: Number(e.ftthSold) || 0,
        ftthActivated: Number(e.ftthActivated) || 0,
        leaseSold: Number(e.leaseSold) || 0,
        ebSold: Number(e.ebSold) || 0,
        entries: Number(e.entries) || 0,
      }));
      
      return {
        totals: {
          simsSold,
          simsActivated,
          ftthSold,
          ftthActivated,
          leaseSold,
          ebSold,
          totalEntries: Number(totals?.totalEntries) || 0,
          simActivationRate: simsSold > 0 ? Math.round((simsActivated / simsSold) * 100) : 0,
          ftthActivationRate: ftthSold > 0 ? Math.round((ftthActivated / ftthSold) * 100) : 0,
        },
        byEmployee,
        byEvent,
        recentEntries,
      };
    }),

  getTeamPerformance: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      circle: z.string().optional(),
      days: z.number().min(7).max(365).optional().default(30),
      limit: z.number().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input }) => {
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }
      
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      
      const conditions: any[] = [gte(eventSalesEntries.createdAt, startDate)];
      
      if (input.circle) {
        conditions.push(eq(employees.circle, input.circle));
      }
      if (!isAdmin && employee[0].persNo) {
        const subquery = getVisibleEmployeeIdsSubquery(employee[0].persNo);
        conditions.push(sql`${eventSalesEntries.employeeId} IN ${subquery}`);
      } else if (!isAdmin) {
        conditions.push(sql`1=0`);
      }
      
      const whereClause = and(...conditions);
      
      const rankingsResult = await db.select({
        id: eventSalesEntries.employeeId,
        name: employees.name,
        designation: employees.designation,
        circle: employees.circle,
        simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        simsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        ftthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
        leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        totalSales: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}) + SUM(${eventSalesEntries.ftthSold}) + SUM(${eventSalesEntries.leaseSold}) + SUM(${eventSalesEntries.ebSold}), 0)::integer`,
        entries: sql<number>`COUNT(*)`,
      })
      .from(eventSalesEntries)
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .where(whereClause)
      .groupBy(eventSalesEntries.employeeId, employees.name, employees.designation, employees.circle)
      .orderBy(sql`SUM(${eventSalesEntries.simsSold}) + SUM(${eventSalesEntries.ftthSold}) + SUM(${eventSalesEntries.leaseSold}) + SUM(${eventSalesEntries.ebSold}) DESC`)
      .limit(input.limit);
      
      const grandTotal = rankingsResult.reduce((sum, r) => sum + (Number(r.totalSales) || 0), 0);
      
      const rankings = rankingsResult.map((r, index) => {
        const totalSales = Number(r.totalSales) || 0;
        return {
          id: r.id || '',
          rank: index + 1,
          name: r.name || 'Unknown',
          designation: r.designation || '',
          circle: r.circle || '',
          simsSold: Number(r.simsSold) || 0,
          simsActivated: Number(r.simsActivated) || 0,
          ftthSold: Number(r.ftthSold) || 0,
          ftthActivated: Number(r.ftthActivated) || 0,
          leaseSold: Number(r.leaseSold) || 0,
          ebSold: Number(r.ebSold) || 0,
          totalSales,
          entries: Number(r.entries) || 0,
          contribution: grandTotal > 0 ? Math.round((totalSales / grandTotal) * 100) : 0,
        };
      });
      
      return { rankings, grandTotal };
    }),

  getSalesTrends: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      circle: z.string().optional(),
      days: z.number().min(7).max(90).optional().default(30),
    }))
    .query(async ({ input }) => {
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }
      
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      
      const conditions: any[] = [gte(eventSalesEntries.createdAt, startDate)];
      
      if (input.circle) {
        conditions.push(eq(employees.circle, input.circle));
      }
      if (!isAdmin && employee[0].persNo) {
        const subquery = getVisibleEmployeeIdsSubquery(employee[0].persNo);
        conditions.push(sql`${eventSalesEntries.employeeId} IN ${subquery}`);
      } else if (!isAdmin) {
        conditions.push(sql`1=0`);
      }
      
      const whereClause = and(...conditions);
      
      const dailyResult = await db.select({
        date: sql<string>`DATE(${eventSalesEntries.createdAt})`,
        simsSold: sql<number>`COALESCE(SUM(${eventSalesEntries.simsSold}), 0)::integer`,
        simsActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.simsActivated}), 0)::integer`,
        ftthSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthSold}), 0)::integer`,
        ftthActivated: sql<number>`COALESCE(SUM(${eventSalesEntries.ftthActivated}), 0)::integer`,
        leaseSold: sql<number>`COALESCE(SUM(${eventSalesEntries.leaseSold}), 0)::integer`,
        ebSold: sql<number>`COALESCE(SUM(${eventSalesEntries.ebSold}), 0)::integer`,
      })
      .from(eventSalesEntries)
      .leftJoin(employees, eq(eventSalesEntries.employeeId, employees.id))
      .where(whereClause)
      .groupBy(sql`DATE(${eventSalesEntries.createdAt})`)
      .orderBy(sql`DATE(${eventSalesEntries.createdAt})`);
      
      const daily = dailyResult.map(d => ({
        date: String(d.date),
        simsSold: Number(d.simsSold) || 0,
        simsActivated: Number(d.simsActivated) || 0,
        ftthSold: Number(d.ftthSold) || 0,
        ftthActivated: Number(d.ftthActivated) || 0,
        leaseSold: Number(d.leaseSold) || 0,
        ebSold: Number(d.ebSold) || 0,
      }));
      
      let totalSims = 0;
      let totalFtth = 0;
      let totalLease = 0;
      let totalEb = 0;
      for (const day of daily) {
        totalSims += day.simsSold;
        totalFtth += day.ftthSold;
        totalLease += day.leaseSold;
        totalEb += day.ebSold;
      }
      
      const avgDailySims = daily.length > 0 ? Math.round(totalSims / daily.length) : 0;
      const avgDailyFtth = daily.length > 0 ? Math.round(totalFtth / daily.length) : 0;
      const avgDailyLease = daily.length > 0 ? Math.round(totalLease / daily.length) : 0;
      const avgDailyEb = daily.length > 0 ? Math.round(totalEb / daily.length) : 0;
      
      return {
        daily,
        summary: {
          totalDays: daily.length,
          totalSims,
          totalFtth,
          totalLease,
          totalEb,
          avgDailySims,
          avgDailyFtth,
          avgDailyLease,
          avgDailyEb,
        },
      };
    }),

  getOperationsAnalytics: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      circle: z.string().optional(),
      days: z.number().min(7).max(90).optional().default(30),
    }))
    .query(async ({ input }) => {
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const conditions: any[] = [gte(maintenanceEntries.createdAt, startDate)];
      if (input.circle) {
        conditions.push(eq(employees.circle, input.circle));
      }
      if (!isAdmin && employee[0].persNo) {
        const subquery = getVisibleEmployeeIdsSubquery(employee[0].persNo);
        conditions.push(sql`${maintenanceEntries.employeeId} IN ${subquery}`);
      } else if (!isAdmin) {
        conditions.push(sql`1=0`);
      }
      const whereClause = and(...conditions);

      // Totals by task type
      const byTypeResult = await db.select({
        taskType: maintenanceEntries.taskType,
        total: sql<number>`COALESCE(SUM(${maintenanceEntries.increment}), 0)::integer`,
        entries: sql<number>`COUNT(*)`,
      })
        .from(maintenanceEntries)
        .leftJoin(employees, eq(maintenanceEntries.employeeId, employees.id))
        .where(whereClause)
        .groupBy(maintenanceEntries.taskType);

      const byType: Record<string, { total: number; entries: number }> = {
        BTS_DOWN: { total: 0, entries: 0 },
        FTTH_DOWN: { total: 0, entries: 0 },
        ROUTE_FAIL: { total: 0, entries: 0 },
        OFC_FAIL: { total: 0, entries: 0 },
      };
      let grandTotal = 0;
      let totalEntries = 0;
      for (const r of byTypeResult) {
        const k = String(r.taskType);
        if (byType[k]) {
          byType[k].total = Number(r.total) || 0;
          byType[k].entries = Number(r.entries) || 0;
        }
        grandTotal += Number(r.total) || 0;
        totalEntries += Number(r.entries) || 0;
      }

      // By employee (top performers across all task types)
      const byEmployeeRaw = await db.select({
        id: maintenanceEntries.employeeId,
        name: employees.name,
        designation: employees.designation,
        circle: employees.circle,
        taskType: maintenanceEntries.taskType,
        total: sql<number>`COALESCE(SUM(${maintenanceEntries.increment}), 0)::integer`,
      })
        .from(maintenanceEntries)
        .leftJoin(employees, eq(maintenanceEntries.employeeId, employees.id))
        .where(whereClause)
        .groupBy(maintenanceEntries.employeeId, employees.name, employees.designation, employees.circle, maintenanceEntries.taskType);

      const empMap = new Map<string, { id: string; name: string; designation: string; circle: string; btsDown: number; ftthDown: number; routeFail: number; ofcFail: number; total: number }>();
      for (const r of byEmployeeRaw) {
        const id = r.id || '';
        if (!empMap.has(id)) {
          empMap.set(id, { id, name: r.name || 'Unknown', designation: r.designation || '', circle: r.circle || '', btsDown: 0, ftthDown: 0, routeFail: 0, ofcFail: 0, total: 0 });
        }
        const m = empMap.get(id)!;
        const v = Number(r.total) || 0;
        if (r.taskType === 'BTS_DOWN') m.btsDown = v;
        else if (r.taskType === 'FTTH_DOWN') m.ftthDown = v;
        else if (r.taskType === 'ROUTE_FAIL') m.routeFail = v;
        else if (r.taskType === 'OFC_FAIL') m.ofcFail = v;
        m.total = m.btsDown + m.ftthDown + m.routeFail + m.ofcFail;
      }
      const byEmployee = Array.from(empMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map((m, i) => ({ ...m, rank: i + 1, contribution: grandTotal > 0 ? Math.round((m.total / grandTotal) * 100) : 0 }));

      // Daily series by task type
      const dailyRaw = await db.select({
        date: sql<string>`DATE(${maintenanceEntries.createdAt})`,
        taskType: maintenanceEntries.taskType,
        total: sql<number>`COALESCE(SUM(${maintenanceEntries.increment}), 0)::integer`,
      })
        .from(maintenanceEntries)
        .leftJoin(employees, eq(maintenanceEntries.employeeId, employees.id))
        .where(whereClause)
        .groupBy(sql`DATE(${maintenanceEntries.createdAt})`, maintenanceEntries.taskType)
        .orderBy(sql`DATE(${maintenanceEntries.createdAt})`);

      const dailyMap = new Map<string, { date: string; btsDown: number; ftthDown: number; routeFail: number; ofcFail: number }>();
      for (const r of dailyRaw) {
        const d = String(r.date);
        if (!dailyMap.has(d)) dailyMap.set(d, { date: d, btsDown: 0, ftthDown: 0, routeFail: 0, ofcFail: 0 });
        const e = dailyMap.get(d)!;
        const v = Number(r.total) || 0;
        if (r.taskType === 'BTS_DOWN') e.btsDown = v;
        else if (r.taskType === 'FTTH_DOWN') e.ftthDown = v;
        else if (r.taskType === 'ROUTE_FAIL') e.routeFail = v;
        else if (r.taskType === 'OFC_FAIL') e.ofcFail = v;
      }
      const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      return {
        totals: { grandTotal, totalEntries, byType },
        byEmployee,
        daily,
      };
    }),

  getFinanceAnalytics: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      circle: z.string().optional(),
      days: z.number().min(7).max(90).optional().default(30),
    }))
    .query(async ({ input }) => {
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
      if (!employee[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }
      const userRole = employee[0].role;
      const isAdmin = userRole === 'ADMIN';

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const conditions: any[] = [gte(financeCollectionEntries.createdAt, startDate)];
      if (input.circle) {
        conditions.push(eq(employees.circle, input.circle));
      }
      if (!isAdmin && employee[0].persNo) {
        const subquery = getVisibleEmployeeIdsSubquery(employee[0].persNo);
        conditions.push(sql`${financeCollectionEntries.employeeId} IN ${subquery}`);
      } else if (!isAdmin) {
        conditions.push(sql`1=0`);
      }
      const whereClauseAll = and(...conditions);
      const whereClauseApproved = and(...conditions, eq(financeCollectionEntries.approvalStatus, 'approved'));

      // Top collectors (approved only)
      const collectorsRaw = await db.select({
        id: financeCollectionEntries.employeeId,
        name: employees.name,
        designation: employees.designation,
        circle: employees.circle,
        financeType: financeCollectionEntries.financeType,
        amount: sql<number>`COALESCE(SUM(${financeCollectionEntries.amountCollected}), 0)::bigint`,
      })
        .from(financeCollectionEntries)
        .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
        .where(whereClauseApproved)
        .groupBy(financeCollectionEntries.employeeId, employees.name, employees.designation, employees.circle, financeCollectionEntries.financeType);

      type CollectorRow = { id: string; name: string; designation: string; circle: string; FIN_LC: number; FIN_LL_FTTH: number; FIN_TOWER: number; FIN_GSM_POSTPAID: number; FIN_RENT_BUILDING: number; total: number };
      const cMap = new Map<string, CollectorRow>();
      for (const r of collectorsRaw) {
        const id = r.id || '';
        if (!cMap.has(id)) {
          cMap.set(id, { id, name: r.name || 'Unknown', designation: r.designation || '', circle: r.circle || '', FIN_LC: 0, FIN_LL_FTTH: 0, FIN_TOWER: 0, FIN_GSM_POSTPAID: 0, FIN_RENT_BUILDING: 0, total: 0 });
        }
        const m = cMap.get(id)!;
        const v = Number(r.amount) || 0;
        const k = r.financeType as keyof CollectorRow;
        if (k === 'FIN_LC' || k === 'FIN_LL_FTTH' || k === 'FIN_TOWER' || k === 'FIN_GSM_POSTPAID' || k === 'FIN_RENT_BUILDING') {
          (m[k] as number) = v;
        }
        m.total = m.FIN_LC + m.FIN_LL_FTTH + m.FIN_TOWER + m.FIN_GSM_POSTPAID + m.FIN_RENT_BUILDING;
      }
      const grandApproved = Array.from(cMap.values()).reduce((a, b) => a + b.total, 0);
      const byEmployee = Array.from(cMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map((m, i) => ({ ...m, rank: i + 1, contribution: grandApproved > 0 ? Math.round((m.total / grandApproved) * 100) : 0 }));

      // Daily series by finance type (approved only)
      const dailyRaw = await db.select({
        date: sql<string>`DATE(${financeCollectionEntries.createdAt})`,
        financeType: financeCollectionEntries.financeType,
        amount: sql<number>`COALESCE(SUM(${financeCollectionEntries.amountCollected}), 0)::bigint`,
      })
        .from(financeCollectionEntries)
        .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
        .where(whereClauseApproved)
        .groupBy(sql`DATE(${financeCollectionEntries.createdAt})`, financeCollectionEntries.financeType)
        .orderBy(sql`DATE(${financeCollectionEntries.createdAt})`);

      const dMap = new Map<string, { date: string; FIN_LC: number; FIN_LL_FTTH: number; FIN_TOWER: number; FIN_GSM_POSTPAID: number; FIN_RENT_BUILDING: number }>();
      for (const r of dailyRaw) {
        const d = String(r.date);
        if (!dMap.has(d)) dMap.set(d, { date: d, FIN_LC: 0, FIN_LL_FTTH: 0, FIN_TOWER: 0, FIN_GSM_POSTPAID: 0, FIN_RENT_BUILDING: 0 });
        const m = dMap.get(d)!;
        const v = Number(r.amount) || 0;
        const k = r.financeType;
        if (k === 'FIN_LC' || k === 'FIN_LL_FTTH' || k === 'FIN_TOWER' || k === 'FIN_GSM_POSTPAID' || k === 'FIN_RENT_BUILDING') {
          (m[k] as number) = v;
        }
      }
      const daily = Array.from(dMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // Pending vs approved totals across window
      const statusRaw = await db.select({
        approvalStatus: financeCollectionEntries.approvalStatus,
        amount: sql<number>`COALESCE(SUM(${financeCollectionEntries.amountCollected}), 0)::bigint`,
        entries: sql<number>`COUNT(*)`,
      })
        .from(financeCollectionEntries)
        .leftJoin(employees, eq(financeCollectionEntries.employeeId, employees.id))
        .where(whereClauseAll)
        .groupBy(financeCollectionEntries.approvalStatus);

      let approvedAmount = 0, pendingAmount = 0, rejectedAmount = 0;
      let approvedEntries = 0, pendingEntries = 0, rejectedEntries = 0;
      for (const r of statusRaw) {
        const v = Number(r.amount) || 0;
        const e = Number(r.entries) || 0;
        if (r.approvalStatus === 'approved') { approvedAmount = v; approvedEntries = e; }
        else if (r.approvalStatus === 'pending') { pendingAmount = v; pendingEntries = e; }
        else if (r.approvalStatus === 'rejected') { rejectedAmount = v; rejectedEntries = e; }
      }

      return {
        totals: { approvedAmount, pendingAmount, rejectedAmount, approvedEntries, pendingEntries, rejectedEntries },
        byEmployee,
        daily,
      };
    }),
});
