import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, salesReports, auditLogs, events, employees } from "@/backend/db";

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
});
