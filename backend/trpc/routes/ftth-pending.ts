import { z } from "zod";
import { eq, sql, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, ftthOrderPending } from "@/backend/db";
import { employeeMaster, employees } from "@/backend/db/schema";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;
const MAX_BATCH_SIZE = 1000;

async function verifyManagementRole(employeeId: string): Promise<boolean> {
  if (!employeeId) return false;
  const result = await db.select({ role: employees.role })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  
  const managementRoles = ['GM', 'CGM', 'DGM', 'AGM'];
  return result[0] ? managementRoles.includes(result[0].role || '') : false;
}

export const ftthPendingRouter = createTRPCRouter({
  getByPersNo: publicProcedure
    .input(z.object({ 
      persNo: z.string().min(1, "Pers No is required").max(50) 
    }))
    .query(async ({ input }) => {
      try {
        const normalizedPersNo = input.persNo.trim().replace(/^0+/, '') || input.persNo.trim();
        const results = await db.select().from(ftthOrderPending)
          .where(eq(ftthOrderPending.persNo, normalizedPersNo));
        return results;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch FTTH pending orders',
        });
      }
    }),

  getAll: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    }).optional())
    .query(async ({ input }) => {
      try {
        const page = input?.page ?? 1;
        const limit = Math.min(input?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const offset = (page - 1) * limit;
        
        const [results, countResult] = await Promise.all([
          db.select().from(ftthOrderPending)
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)` }).from(ftthOrderPending)
        ]);
        
        const total = Number(countResult[0]?.count ?? 0);
        
        return {
          data: results,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          }
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch FTTH pending orders list',
        });
      }
    }),

  getSummary: publicProcedure
    .query(async () => {
      try {
        const result = await db.select({
          totalRecords: sql<number>`count(*)`,
          totalPendingOrders: sql<number>`coalesce(sum(total_ftth_orders_pending), 0)`,
          uniqueEmployees: sql<number>`count(distinct pers_no)`,
          uniqueBAs: sql<number>`count(distinct ba)`,
        }).from(ftthOrderPending);
        
        return {
          totalRecords: Number(result[0]?.totalRecords ?? 0),
          totalPendingOrders: Number(result[0]?.totalPendingOrders ?? 0),
          uniqueEmployees: Number(result[0]?.uniqueEmployees ?? 0),
          uniqueBAs: Number(result[0]?.uniqueBAs ?? 0),
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch FTTH pending summary',
        });
      }
    }),

  getEmployeesWithPending: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(MAX_LIMIT).default(200),
    }).optional())
    .query(async ({ input }) => {
      try {
        const page = input?.page ?? 1;
        const limit = Math.min(input?.limit ?? 200, MAX_LIMIT);
        const offset = (page - 1) * limit;
        
        const [results, countResult] = await Promise.all([
          db.select({
            persNo: ftthOrderPending.persNo,
            totalPending: sql<number>`sum(${ftthOrderPending.totalFtthOrdersPending})`,
            baCount: sql<number>`count(distinct ${ftthOrderPending.ba})`,
            name: employeeMaster.name,
            designation: employeeMaster.designation,
            circle: employeeMaster.circle,
            zone: employeeMaster.zone,
            division: employeeMaster.division,
            employeeMasterId: employeeMaster.id,
          })
            .from(ftthOrderPending)
            .leftJoin(employeeMaster, eq(ftthOrderPending.persNo, employeeMaster.persNo))
            .groupBy(
              ftthOrderPending.persNo,
              employeeMaster.name,
              employeeMaster.designation,
              employeeMaster.circle,
              employeeMaster.zone,
              employeeMaster.division,
              employeeMaster.id
            )
            .orderBy(desc(sql`sum(${ftthOrderPending.totalFtthOrdersPending})`))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(distinct pers_no)` }).from(ftthOrderPending)
        ]);
        
        const total = Number(countResult[0]?.count ?? 0);
        
        return {
          employees: results.map(r => ({
            persNo: r.persNo,
            name: r.name || 'Unknown',
            designation: r.designation || 'N/A',
            circle: r.circle || 'N/A',
            zone: r.zone || 'N/A',
            division: r.division || 'N/A',
            totalPending: Number(r.totalPending) || 0,
            baCount: Number(r.baCount) || 0,
            employeeMasterId: r.employeeMasterId,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          }
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch employees with pending orders',
        });
      }
    }),

  importData: publicProcedure
    .input(z.object({
      data: z.array(z.object({
        persNo: z.string(),
        ba: z.string(),
        totalFtthOrdersPending: z.number().min(0),
      })).max(10000, "Maximum 10,000 records per import"),
      clearExisting: z.boolean().default(false),
      uploadedBy: z.string().uuid("Valid employee ID required"),
    }))
    .mutation(async ({ input }) => {
      const isManagement = await verifyManagementRole(input.uploadedBy);
      if (!isManagement) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only management roles can import FTTH pending data',
        });
      }
      
      try {
        if (input.clearExisting) {
          await db.delete(ftthOrderPending);
        }
        
        const validRecords = input.data.filter(record => 
          record.persNo && record.persNo.trim() !== '' &&
          record.ba && record.ba.trim() !== ''
        );
        
        if (validRecords.length === 0) {
          return { 
            imported: 0, 
            skipped: input.data.length,
            message: 'No valid records to import'
          };
        }
        
        let imported = 0;
        const errors: string[] = [];
        
        for (let i = 0; i < validRecords.length; i += MAX_BATCH_SIZE) {
          const batch = validRecords.slice(i, i + MAX_BATCH_SIZE);
          try {
            await db.insert(ftthOrderPending).values(
              batch.map(record => ({
                persNo: record.persNo.trim(),
                ba: record.ba.trim(),
                totalFtthOrdersPending: record.totalFtthOrdersPending,
              }))
            );
            imported += batch.length;
          } catch (batchError: any) {
            errors.push(`Batch ${Math.floor(i / MAX_BATCH_SIZE) + 1}: ${batchError.message || 'Unknown error'}`);
          }
        }
        
        return {
          imported,
          skipped: input.data.length - validRecords.length,
          errors: errors.length > 0 ? errors : undefined,
          message: `Successfully imported ${imported} records`,
        };
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to import FTTH pending data',
        });
      }
    }),

  deleteAll: publicProcedure
    .input(z.object({
      confirmedBy: z.string().uuid("Valid employee ID required"),
      confirmText: z.literal("DELETE ALL FTTH PENDING DATA"),
    }))
    .mutation(async ({ input }) => {
      const isManagement = await verifyManagementRole(input.confirmedBy);
      if (!isManagement) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only management roles can delete FTTH pending data',
        });
      }
      
      try {
        const countBefore = await db.select({ count: sql<number>`count(*)` }).from(ftthOrderPending);
        await db.delete(ftthOrderPending);
        
        return { 
          success: true,
          deletedCount: Number(countBefore[0]?.count ?? 0),
          message: `Deleted ${countBefore[0]?.count ?? 0} records`
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete FTTH pending data',
        });
      }
    }),

  upsertRecord: publicProcedure
    .input(z.object({
      persNo: z.string().min(1, "Pers No is required").max(50),
      ba: z.string().min(1, "BA is required").max(100),
      totalFtthOrdersPending: z.number().min(0, "Pending count must be non-negative"),
      updatedBy: z.string().uuid("Valid employee ID required"),
    }))
    .mutation(async ({ input }) => {
      const isManagement = await verifyManagementRole(input.updatedBy);
      if (!isManagement) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only management roles can update FTTH pending data',
        });
      }
      
      try {
        const existing = await db.select().from(ftthOrderPending)
          .where(and(
            eq(ftthOrderPending.persNo, input.persNo.trim()),
            eq(ftthOrderPending.ba, input.ba.trim())
          ));
        
        if (existing.length > 0) {
          const result = await db.update(ftthOrderPending)
            .set({
              totalFtthOrdersPending: input.totalFtthOrdersPending,
              updatedAt: new Date(),
            })
            .where(and(
              eq(ftthOrderPending.persNo, input.persNo.trim()),
              eq(ftthOrderPending.ba, input.ba.trim())
            ))
            .returning();
          return { ...result[0], operation: 'updated' as const };
        } else {
          const result = await db.insert(ftthOrderPending).values({
            persNo: input.persNo.trim(),
            ba: input.ba.trim(),
            totalFtthOrdersPending: input.totalFtthOrdersPending,
          }).returning();
          return { ...result[0], operation: 'created' as const };
        }
      } catch (error: any) {
        if (error.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A record with this Pers No and BA already exists',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save FTTH pending record',
        });
      }
    }),
});
