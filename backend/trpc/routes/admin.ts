import { z } from "zod";
import { eq, sql, desc, and, isNull, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, employees, employeeMaster, auditLogs, events } from "@/backend/db";

export const adminRouter = createTRPCRouter({
  importEmployeeMaster: publicProcedure
    .input(z.object({
      data: z.array(z.object({
        persNo: z.string().min(1),
        name: z.string().min(1),
        circle: z.string().optional(),
        zone: z.string().optional(),
        designation: z.string().optional(),
        empGroup: z.string().optional(),
        reportingPersNo: z.string().optional(),
        reportingOfficerName: z.string().optional(),
        reportingOfficerDesignation: z.string().optional(),
        division: z.string().optional(),
        buildingName: z.string().optional(),
        officeName: z.string().optional(),
        shiftGroup: z.string().optional(),
        distanceLimit: z.string().optional(),
        sortOrder: z.number().optional(),
        employeeId: z.string().optional(),
      })),
      uploadedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Importing employee master data:", input.data.length, "records");
      
      // Server-side role validation: Only ADMIN can import CSV
      const uploader = await db.select().from(employees).where(eq(employees.id, input.uploadedBy)).limit(1);
      if (uploader[0]?.role !== 'ADMIN') {
        throw new Error('Only admin users can import employee data. Access denied.');
      }
      
      let imported = 0;
      let updated = 0;
      let errors: string[] = [];
      
      for (const record of input.data) {
        try {
          const existing = await db.select().from(employeeMaster)
            .where(eq(employeeMaster.persNo, record.persNo));
          
          if (existing[0]) {
            await db.update(employeeMaster)
              .set({
                name: record.name,
                circle: record.circle || null,
                zone: record.zone || null,
                designation: record.designation || null,
                empGroup: record.empGroup || null,
                reportingPersNo: record.reportingPersNo || null,
                reportingOfficerName: record.reportingOfficerName || null,
                reportingOfficerDesignation: record.reportingOfficerDesignation || null,
                division: record.division || null,
                buildingName: record.buildingName || null,
                officeName: record.officeName || null,
                shiftGroup: record.shiftGroup || null,
                distanceLimit: record.distanceLimit || null,
                sortOrder: record.sortOrder || null,
                employeeId: record.employeeId || null,
                updatedAt: new Date(),
              })
              .where(eq(employeeMaster.persNo, record.persNo));
            updated++;
          } else {
            await db.insert(employeeMaster).values({
              persNo: record.persNo,
              name: record.name,
              circle: record.circle || null,
              zone: record.zone || null,
              designation: record.designation || null,
              empGroup: record.empGroup || null,
              reportingPersNo: record.reportingPersNo || null,
              reportingOfficerName: record.reportingOfficerName || null,
              reportingOfficerDesignation: record.reportingOfficerDesignation || null,
              division: record.division || null,
              buildingName: record.buildingName || null,
              officeName: record.officeName || null,
              shiftGroup: record.shiftGroup || null,
              distanceLimit: record.distanceLimit || null,
              sortOrder: record.sortOrder || null,
              employeeId: record.employeeId || null,
            });
            imported++;
          }
        } catch (error: any) {
          errors.push(`Row ${record.persNo}: ${error.message}`);
        }
      }
      
      await db.insert(auditLogs).values({
        action: 'IMPORT_EMPLOYEE_MASTER',
        entityType: 'EMPLOYEE',
        entityId: input.uploadedBy,
        performedBy: input.uploadedBy,
        details: { imported, updated, errors: errors.length },
      });
      
      return { imported, updated, errors };
    }),

  getEmployeeMasterList: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      linked: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      userId: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching employee master list");
      
      // Get user's role and circle for filtering
      let userRole: string | null = null;
      let userCircle: string | null = null;
      
      if (input?.userId) {
        const user = await db.select().from(employees).where(eq(employees.id, input.userId)).limit(1);
        if (user[0]) {
          userRole = user[0].role;
          userCircle = user[0].circle;
        }
      }
      
      // Build query with filters
      const conditions: any[] = [];
      
      if (input?.linked === true) {
        conditions.push(eq(employeeMaster.isLinked, true));
      } else if (input?.linked === false) {
        conditions.push(eq(employeeMaster.isLinked, false));
      }
      
      // GM/CGM can only see their own circle employees
      // ADMIN can see all circles
      if (userRole && userRole !== 'ADMIN' && userCircle) {
        conditions.push(eq(employeeMaster.circle, userCircle));
        console.log(`Filtering employees by circle: ${userCircle} for role: ${userRole}`);
      }
      
      let query = db.select().from(employeeMaster);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const results = await query
        .orderBy(desc(employeeMaster.createdAt))
        .limit(input?.limit || 50)
        .offset(input?.offset || 0);
      
      // Count with same filters
      let countQuery = db.select({ count: sql<number>`count(*)` }).from(employeeMaster);
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as any;
      }
      const countResult = await countQuery;
      const total = Number(countResult[0]?.count || 0);
      
      return { data: results, total };
    }),

  getEmployeeMasterByPurseId: publicProcedure
    .input(z.object({ persNo: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee master by purse ID:", input.persNo);
      
      const result = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.persNo, input.persNo));
      
      if (!result[0]) return null;
      
      let manager = null;
      if (result[0].reportingPersNo) {
        const managerResult = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, result[0].reportingPersNo));
        manager = managerResult[0] || null;
      }
      
      return { ...result[0], manager };
    }),

  linkEmployeeProfile: publicProcedure
    .input(z.object({
      persNo: z.string(),
      employeeId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Linking employee profile:", input.persNo, "to", input.employeeId);
      
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.persNo, input.persNo));
      
      if (!masterRecord[0]) {
        throw new Error("Purse ID not found in employee master data. Please contact admin.");
      }
      
      if (masterRecord[0].isLinked && masterRecord[0].linkedEmployeeId !== input.employeeId) {
        throw new Error("This Purse ID is already linked to another account.");
      }
      
      await db.update(employeeMaster)
        .set({
          isLinked: true,
          linkedEmployeeId: input.employeeId,
          linkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeMaster.persNo, input.persNo));
      
      let reportingPersNo = null;
      if (masterRecord[0].reportingPersNo) {
        const managerMaster = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, masterRecord[0].reportingPersNo));
        
        if (managerMaster[0]?.linkedEmployeeId) {
          reportingPersNo = managerMaster[0].linkedEmployeeId;
        }
      }
      
      await db.update(employees)
        .set({
          persNo: input.persNo,
          reportingPersNo: reportingPersNo,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, input.employeeId));
      
      const subordinateMasters = await db.select().from(employeeMaster)
        .where(and(
          eq(employeeMaster.reportingPersNo, input.persNo),
          eq(employeeMaster.isLinked, true)
        ));
      
      for (const sub of subordinateMasters) {
        if (sub.linkedEmployeeId) {
          await db.update(employees)
            .set({
              reportingPersNo: input.employeeId,
              updatedAt: new Date(),
            })
            .where(eq(employees.id, sub.linkedEmployeeId));
        }
      }
      
      await db.insert(auditLogs).values({
        action: 'LINK_EMPLOYEE_PROFILE',
        entityType: 'EMPLOYEE',
        entityId: input.employeeId,
        performedBy: input.employeeId,
        details: { persNo: input.persNo, subordinatesUpdated: subordinateMasters.length },
      });
      
      return { success: true, masterData: masterRecord[0] };
    }),

  getMyHierarchy: publicProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching hierarchy for employee:", input.employeeId);
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]?.persNo) {
        return { manager: null, subordinates: [], isLinked: false };
      }
      
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.persNo, employee[0].persNo));
      
      if (!masterRecord[0]) {
        return { manager: null, subordinates: [], isLinked: false };
      }
      
      let manager = null;
      if (masterRecord[0].reportingPersNo) {
        const managerMaster = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, masterRecord[0].reportingPersNo));
        
        if (managerMaster[0]) {
          if (managerMaster[0].linkedEmployeeId) {
            const managerEmployee = await db.select().from(employees)
              .where(eq(employees.id, managerMaster[0].linkedEmployeeId));
            manager = {
              ...managerMaster[0],
              employee: managerEmployee[0] || null,
            };
          } else {
            manager = { ...managerMaster[0], employee: null };
          }
        }
      }
      
      const subordinateMasters = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.reportingPersNo, employee[0].persNo));
      
      const subordinates = await Promise.all(
        subordinateMasters.map(async (sub) => {
          if (sub.linkedEmployeeId) {
            const subEmployee = await db.select().from(employees)
              .where(eq(employees.id, sub.linkedEmployeeId));
            return { ...sub, employee: subEmployee[0] || null };
          }
          return { ...sub, employee: null };
        })
      );
      
      return {
        manager,
        subordinates,
        isLinked: true,
        masterData: masterRecord[0],
      };
    }),

  deleteEmployeeMaster: publicProcedure
    .input(z.object({
      persNo: z.string(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Deleting employee master:", input.persNo);
      
      const record = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.persNo, input.persNo));
      
      if (record[0]?.isLinked) {
        throw new Error("Cannot delete linked employee. Unlink first.");
      }
      
      await db.delete(employeeMaster)
        .where(eq(employeeMaster.persNo, input.persNo));
      
      await db.insert(auditLogs).values({
        action: 'DELETE_EMPLOYEE_MASTER',
        entityType: 'EMPLOYEE',
        entityId: input.deletedBy,
        performedBy: input.deletedBy,
        details: { persNo: input.persNo },
      });
      
      return { success: true };
    }),

  clearEmployeeMaster: publicProcedure
    .input(z.object({ clearedBy: z.string().uuid() }))
    .mutation(async ({ input }) => {
      console.log("Clearing all unlinked employee master records");
      
      // Server-side role validation: Only ADMIN can clear records
      const user = await db.select().from(employees).where(eq(employees.id, input.clearedBy)).limit(1);
      if (user[0]?.role !== 'ADMIN') {
        throw new Error('Only admin users can clear employee data. Access denied.');
      }
      
      const result = await db.delete(employeeMaster)
        .where(eq(employeeMaster.isLinked, false));
      
      await db.insert(auditLogs).values({
        action: 'CLEAR_EMPLOYEE_MASTER',
        entityType: 'EMPLOYEE',
        entityId: input.clearedBy,
        performedBy: input.clearedBy,
        details: { action: 'cleared_unlinked' },
      });
      
      return { success: true };
    }),

  getEmployeeMasterStats: publicProcedure
    .input(z.object({
      userId: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input }) => {
      // Get user's role and circle for filtering
      let userRole: string | null = null;
      let userCircle: string | null = null;
      
      if (input?.userId) {
        const user = await db.select().from(employees).where(eq(employees.id, input.userId)).limit(1);
        if (user[0]) {
          userRole = user[0].role;
          userCircle = user[0].circle;
        }
      }
      
      // GM/CGM can only see their own circle stats
      // ADMIN can see all circles
      const circleFilter = (userRole && userRole !== 'ADMIN' && userCircle) 
        ? eq(employeeMaster.circle, userCircle) 
        : undefined;
      
      const total = circleFilter 
        ? await db.select({ count: sql<number>`count(*)` }).from(employeeMaster).where(circleFilter)
        : await db.select({ count: sql<number>`count(*)` }).from(employeeMaster);
        
      const linked = circleFilter
        ? await db.select({ count: sql<number>`count(*)` }).from(employeeMaster).where(and(eq(employeeMaster.isLinked, true), circleFilter))
        : await db.select({ count: sql<number>`count(*)` }).from(employeeMaster).where(eq(employeeMaster.isLinked, true));
      
      return {
        total: Number(total[0]?.count || 0),
        linked: Number(linked[0]?.count || 0),
        unlinked: Number(total[0]?.count || 0) - Number(linked[0]?.count || 0),
      };
    }),

  importEvents: publicProcedure
    .input(z.object({
      data: z.array(z.object({
        name: z.string().min(1),
        location: z.string().min(1),
        circle: z.string().optional().default(''),
        zone: z.string().optional(),
        startDate: z.string(),
        endDate: z.string(),
        category: z.string().min(1),
        keyInsight: z.string().optional(),
        rowNumber: z.number().optional(),
      })),
      uploadedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Importing events:", input.data.length, "records");
      
      // Server-side role validation: Only ADMIN can import events
      const uploader = await db.select().from(employees).where(eq(employees.id, input.uploadedBy)).limit(1);
      if (uploader[0]?.role !== 'ADMIN') {
        throw new Error('Only admin users can import events. Access denied.');
      }
      
      let imported = 0;
      let updated = 0;
      let errors: string[] = [];
      
      const validCategories = ['Cultural', 'Religious', 'Sports', 'Exhibition', 'Fair', 'Festival', 'Agri-Tourism', 'Eco-Tourism', 'Trade/Religious'];
      
      // Build dynamic zone→circle mapping from employee_master
      const zoneCircleData = await db.selectDistinct({ 
        zone: employeeMaster.zone, 
        circle: employeeMaster.circle 
      }).from(employeeMaster).where(
        and(
          sql`${employeeMaster.zone} IS NOT NULL`,
          sql`${employeeMaster.zone} != ''`,
          sql`${employeeMaster.circle} IS NOT NULL`,
          sql`${employeeMaster.circle} != ''`
        )
      );
      
      // Convert circle names to enum values (e.g., "Maharashtra Telecom Circle" → "MAHARASHTRA")
      const circleNameToEnum: Record<string, string> = {
        'MAHARASHTRA TELECOM CIRCLE': 'MAHARASHTRA', 'MAHARASHTRA': 'MAHARASHTRA',
        'ANDHRA PRADESH TELECOM CIRCLE': 'ANDHRA_PRADESH', 'ANDHRA PRADESH': 'ANDHRA_PRADESH',
        'KARNATAKA TELECOM CIRCLE': 'KARNATAKA', 'KARNATAKA': 'KARNATAKA',
        'TAMIL NADU TELECOM CIRCLE': 'TAMIL_NADU', 'TAMIL NADU': 'TAMIL_NADU',
        'TELANGANA TELECOM CIRCLE': 'TELANGANA', 'TELANGANA': 'TELANGANA',
        'KERALA TELECOM CIRCLE': 'KERALA', 'KERALA': 'KERALA',
        'GUJARAT TELECOM CIRCLE': 'GUJARAT', 'GUJARAT': 'GUJARAT',
        'RAJASTHAN TELECOM CIRCLE': 'RAJASTHAN', 'RAJASTHAN': 'RAJASTHAN',
        'MADHYA PRADESH TELECOM CIRCLE': 'MADHYA_PRADESH', 'MADHYA PRADESH': 'MADHYA_PRADESH',
        'UTTAR PRADESH EAST TELECOM CIRCLE': 'UTTAR_PRADESH_EAST', 'UTTAR PRADESH EAST': 'UTTAR_PRADESH_EAST',
        'UTTAR PRADESH WEST TELECOM CIRCLE': 'UTTAR_PRADESH_WEST', 'UTTAR PRADESH WEST': 'UTTAR_PRADESH_WEST',
        'WEST BENGAL TELECOM CIRCLE': 'WEST_BENGAL', 'WEST BENGAL': 'WEST_BENGAL',
        'BIHAR TELECOM CIRCLE': 'BIHAR', 'BIHAR': 'BIHAR',
        'ODISHA TELECOM CIRCLE': 'ODISHA', 'ODISHA': 'ODISHA', 'ORISSA': 'ODISHA',
        'PUNJAB TELECOM CIRCLE': 'PUNJAB', 'PUNJAB': 'PUNJAB',
        'HARYANA TELECOM CIRCLE': 'HARYANA', 'HARYANA': 'HARYANA',
        'HIMACHAL PRADESH TELECOM CIRCLE': 'HIMACHAL_PRADESH', 'HIMACHAL PRADESH': 'HIMACHAL_PRADESH',
        'JAMMU KASHMIR TELECOM CIRCLE': 'JAMMU_KASHMIR', 'JAMMU KASHMIR': 'JAMMU_KASHMIR',
        'JHARKHAND TELECOM CIRCLE': 'JHARKHAND', 'JHARKHAND': 'JHARKHAND',
        'CHHATTISGARH TELECOM CIRCLE': 'CHHATTISGARH', 'CHHATTISGARH': 'CHHATTISGARH',
        'UTTARAKHAND TELECOM CIRCLE': 'UTTARAKHAND', 'UTTARAKHAND': 'UTTARAKHAND',
        'ASSAM TELECOM CIRCLE': 'ASSAM', 'ASSAM': 'ASSAM',
        'NORTH EAST I TELECOM CIRCLE': 'NORTH_EAST_I', 'NORTH EAST I': 'NORTH_EAST_I',
        'NORTH EAST II TELECOM CIRCLE': 'NORTH_EAST_II', 'NORTH EAST II': 'NORTH_EAST_II',
        'ANDAMAN NICOBAR TELECOM CIRCLE': 'ANDAMAN_NICOBAR', 'ANDAMAN NICOBAR': 'ANDAMAN_NICOBAR',
      };
      
      // Build zone→circle mapping from employee_master data
      const zoneToCircle: Record<string, string> = {};
      for (const row of zoneCircleData) {
        if (row.zone && row.circle) {
          const zoneUpper = row.zone.toUpperCase().trim();
          const circleUpper = row.circle.toUpperCase().trim();
          const circleEnum = circleNameToEnum[circleUpper];
          if (circleEnum && zoneUpper.length > 2) {
            zoneToCircle[zoneUpper] = circleEnum;
          }
        }
      }
      console.log("Built zone→circle mapping with", Object.keys(zoneToCircle).length, "entries from employee_master");
      
      const circleMapping: Record<string, string> = {
        'ANDAMAN_NICOBAR': 'ANDAMAN_NICOBAR', 'ANDAMAN': 'ANDAMAN_NICOBAR', 'NICOBAR': 'ANDAMAN_NICOBAR',
        'ANDHRA_PRADESH': 'ANDHRA_PRADESH', 'AP': 'ANDHRA_PRADESH', 'ANDHRA': 'ANDHRA_PRADESH',
        'ASSAM': 'ASSAM',
        'BIHAR': 'BIHAR',
        'CHHATTISGARH': 'CHHATTISGARH', 'CG': 'CHHATTISGARH', 'CHATTISGARH': 'CHHATTISGARH',
        'GUJARAT': 'GUJARAT', 'GJ': 'GUJARAT',
        'HARYANA': 'HARYANA', 'HR': 'HARYANA',
        'HIMACHAL_PRADESH': 'HIMACHAL_PRADESH', 'HP': 'HIMACHAL_PRADESH', 'HIMACHAL': 'HIMACHAL_PRADESH',
        'JAMMU_KASHMIR': 'JAMMU_KASHMIR', 'JK': 'JAMMU_KASHMIR', 'J&K': 'JAMMU_KASHMIR', 'JAMMU': 'JAMMU_KASHMIR',
        'JHARKHAND': 'JHARKHAND', 'JH': 'JHARKHAND',
        'KARNATAKA': 'KARNATAKA', 'KA': 'KARNATAKA', 'BANGALORE': 'KARNATAKA',
        'KERALA': 'KERALA', 'KL': 'KERALA',
        'MADHYA_PRADESH': 'MADHYA_PRADESH', 'MP': 'MADHYA_PRADESH',
        'MAHARASHTRA': 'MAHARASHTRA', 'MH': 'MAHARASHTRA', 'MUMBAI': 'MAHARASHTRA',
        'NORTH_EAST_I': 'NORTH_EAST_I', 'NE1': 'NORTH_EAST_I', 'NEI': 'NORTH_EAST_I',
        'NORTH_EAST_II': 'NORTH_EAST_II', 'NE2': 'NORTH_EAST_II', 'NEII': 'NORTH_EAST_II',
        'ODISHA': 'ODISHA', 'OR': 'ODISHA', 'ORISSA': 'ODISHA',
        'PUNJAB': 'PUNJAB', 'PB': 'PUNJAB',
        'RAJASTHAN': 'RAJASTHAN', 'RJ': 'RAJASTHAN',
        'TAMIL_NADU': 'TAMIL_NADU', 'TN': 'TAMIL_NADU', 'TAMILNADU': 'TAMIL_NADU', 'CHENNAI': 'TAMIL_NADU',
        'TELANGANA': 'TELANGANA', 'TS': 'TELANGANA', 'HYDERABAD': 'TELANGANA',
        'UTTARAKHAND': 'UTTARAKHAND', 'UK': 'UTTARAKHAND', 'UTTARANCHAL': 'UTTARAKHAND',
        'UTTAR_PRADESH_EAST': 'UTTAR_PRADESH_EAST', 'UP_EAST': 'UTTAR_PRADESH_EAST', 'UPE': 'UTTAR_PRADESH_EAST',
        'UTTAR_PRADESH_WEST': 'UTTAR_PRADESH_WEST', 'UP_WEST': 'UTTAR_PRADESH_WEST', 'UPW': 'UTTAR_PRADESH_WEST',
        'WEST_BENGAL': 'WEST_BENGAL', 'WB': 'WEST_BENGAL', 'KOLKATA': 'WEST_BENGAL', 'BENGAL': 'WEST_BENGAL',
      };
      
      const locationToCircle: Record<string, string> = {
        // State names (most important for "State-wide" events)
        'MAHARASHTRA': 'MAHARASHTRA', 'KARNATAKA': 'KARNATAKA', 'TAMIL NADU': 'TAMIL_NADU', 'TAMILNADU': 'TAMIL_NADU',
        'TELANGANA': 'TELANGANA', 'ANDHRA PRADESH': 'ANDHRA_PRADESH', 'ANDHRA': 'ANDHRA_PRADESH',
        'WEST BENGAL': 'WEST_BENGAL', 'BENGAL': 'WEST_BENGAL', 'GUJARAT': 'GUJARAT', 'RAJASTHAN': 'RAJASTHAN',
        'UTTAR PRADESH': 'UTTAR_PRADESH_WEST', 'MADHYA PRADESH': 'MADHYA_PRADESH', 'BIHAR': 'BIHAR',
        'ODISHA': 'ODISHA', 'ORISSA': 'ODISHA', 'PUNJAB': 'PUNJAB', 'KERALA': 'KERALA', 'ASSAM': 'ASSAM',
        'JHARKHAND': 'JHARKHAND', 'CHHATTISGARH': 'CHHATTISGARH', 'UTTARAKHAND': 'UTTARAKHAND',
        'HIMACHAL PRADESH': 'HIMACHAL_PRADESH', 'HIMACHAL': 'HIMACHAL_PRADESH', 'HARYANA': 'HARYANA',
        'JAMMU KASHMIR': 'JAMMU_KASHMIR', 'JAMMU AND KASHMIR': 'JAMMU_KASHMIR', 'J&K': 'JAMMU_KASHMIR',
        'ANDAMAN': 'ANDAMAN_NICOBAR', 'NICOBAR': 'ANDAMAN_NICOBAR',
        // Maharashtra cities (extensive)
        'MUMBAI': 'MAHARASHTRA', 'PUNE': 'MAHARASHTRA', 'NAGPUR': 'MAHARASHTRA', 'NASHIK': 'MAHARASHTRA', 
        'THANE': 'MAHARASHTRA', 'AURANGABAD': 'MAHARASHTRA', 'SOLAPUR': 'MAHARASHTRA', 'KOLHAPUR': 'MAHARASHTRA',
        'NAVI MUMBAI': 'MAHARASHTRA', 'SANGLI': 'MAHARASHTRA', 'AMRAVATI': 'MAHARASHTRA', 'AKOLA': 'MAHARASHTRA',
        'LATUR': 'MAHARASHTRA', 'DHULE': 'MAHARASHTRA', 'AHMEDNAGAR': 'MAHARASHTRA', 'CHANDRAPUR': 'MAHARASHTRA',
        'JALGAON': 'MAHARASHTRA', 'SATARA': 'MAHARASHTRA', 'RATNAGIRI': 'MAHARASHTRA', 'SHIRDI': 'MAHARASHTRA',
        'CHHATRAPATI SAMBHAJINAGAR': 'MAHARASHTRA', 'SAMBHAJINAGAR': 'MAHARASHTRA',
        'PALGHAR': 'MAHARASHTRA', 'BORDI': 'MAHARASHTRA', 'TRIMBAKESHWAR': 'MAHARASHTRA', 'TRIMBAK': 'MAHARASHTRA',
        'PARLI': 'MAHARASHTRA', 'KONKAN': 'MAHARASHTRA', 'STATE WIDE': 'MAHARASHTRA', 'STATEWIDE': 'MAHARASHTRA',
        'PATHARDI': 'MAHARASHTRA', 'MADHI': 'MAHARASHTRA', 'STATE-WIDE': 'MAHARASHTRA',
        'PANVEL': 'MAHARASHTRA', 'KALYAN': 'MAHARASHTRA', 'DOMBIVLI': 'MAHARASHTRA', 'VASAI': 'MAHARASHTRA',
        'VIRAR': 'MAHARASHTRA', 'MIRA': 'MAHARASHTRA', 'BHAYANDAR': 'MAHARASHTRA', 'ULHASNAGAR': 'MAHARASHTRA',
        'BHIWANDI': 'MAHARASHTRA', 'MALEGAON': 'MAHARASHTRA', 'NANDED': 'MAHARASHTRA', 'PARBHANI': 'MAHARASHTRA',
        'OSMANABAD': 'MAHARASHTRA', 'BEED': 'MAHARASHTRA', 'JALNA': 'MAHARASHTRA', 'WARDHA': 'MAHARASHTRA',
        'YAVATMAL': 'MAHARASHTRA', 'BULDHANA': 'MAHARASHTRA', 'WASHIM': 'MAHARASHTRA', 'GADCHIROLI': 'MAHARASHTRA',
        'GONDIA': 'MAHARASHTRA', 'BHANDARA': 'MAHARASHTRA', 'ELLORA': 'MAHARASHTRA', 'AJANTA': 'MAHARASHTRA',
        'LONAVALA': 'MAHARASHTRA', 'KHANDALA': 'MAHARASHTRA', 'MAHABALESHWAR': 'MAHARASHTRA', 'PANCHGANI': 'MAHARASHTRA',
        'ALIBAUG': 'MAHARASHTRA', 'MURUD': 'MAHARASHTRA', 'GANPATIPULE': 'MAHARASHTRA', 'SINDHUDURG': 'MAHARASHTRA',
        // Karnataka cities
        'BANGALORE': 'KARNATAKA', 'BENGALURU': 'KARNATAKA', 'MYSORE': 'KARNATAKA', 'MYSURU': 'KARNATAKA', 
        'HUBLI': 'KARNATAKA', 'MANGALORE': 'KARNATAKA', 'MANGALURU': 'KARNATAKA', 'BELGAUM': 'KARNATAKA', 
        'BELAGAVI': 'KARNATAKA', 'DAVANGERE': 'KARNATAKA', 'GULBARGA': 'KARNATAKA', 'KALABURAGI': 'KARNATAKA',
        'SHIMOGA': 'KARNATAKA', 'SHIVAMOGGA': 'KARNATAKA', 'TUMKUR': 'KARNATAKA', 'TUMAKURU': 'KARNATAKA',
        'BIJAPUR': 'KARNATAKA', 'VIJAYAPURA': 'KARNATAKA', 'BELLARY': 'KARNATAKA', 'BALLARI': 'KARNATAKA',
        'DHARWAD': 'KARNATAKA', 'UDUPI': 'KARNATAKA', 'CHITRADURGA': 'KARNATAKA', 'RAICHUR': 'KARNATAKA',
        'HASSAN': 'KARNATAKA', 'BIDAR': 'KARNATAKA', 'MANDYA': 'KARNATAKA', 'CHIKMAGALUR': 'KARNATAKA',
        'COORG': 'KARNATAKA', 'KODAGU': 'KARNATAKA', 'HAMPI': 'KARNATAKA', 'BADAMI': 'KARNATAKA',
        // Tamil Nadu cities
        'CHENNAI': 'TAMIL_NADU', 'COIMBATORE': 'TAMIL_NADU', 'MADURAI': 'TAMIL_NADU', 'SALEM': 'TAMIL_NADU', 
        'TRICHY': 'TAMIL_NADU', 'TIRUCHIRAPPALLI': 'TAMIL_NADU', 'TIRUPUR': 'TAMIL_NADU', 'VELLORE': 'TAMIL_NADU',
        'ERODE': 'TAMIL_NADU', 'THANJAVUR': 'TAMIL_NADU', 'TIRUNELVELI': 'TAMIL_NADU', 'DINDIGUL': 'TAMIL_NADU',
        'KANCHIPURAM': 'TAMIL_NADU', 'CUDDALORE': 'TAMIL_NADU', 'NAGERCOIL': 'TAMIL_NADU', 'THOOTHUKUDI': 'TAMIL_NADU',
        'TUTICORIN': 'TAMIL_NADU', 'KARUR': 'TAMIL_NADU', 'HOSUR': 'TAMIL_NADU', 'KUMBAKONAM': 'TAMIL_NADU',
        'OOTY': 'TAMIL_NADU', 'KODAIKANAL': 'TAMIL_NADU', 'RAMESHWARAM': 'TAMIL_NADU', 'KANYAKUMARI': 'TAMIL_NADU',
        'MAMALLAPURAM': 'TAMIL_NADU', 'PONDICHERRY': 'TAMIL_NADU', 'PUDUCHERRY': 'TAMIL_NADU',
        // Telangana cities
        'HYDERABAD': 'TELANGANA', 'SECUNDERABAD': 'TELANGANA', 'WARANGAL': 'TELANGANA', 'NIZAMABAD': 'TELANGANA', 
        'KARIMNAGAR': 'TELANGANA', 'KHAMMAM': 'TELANGANA', 'RAMAGUNDAM': 'TELANGANA', 'MAHBUBNAGAR': 'TELANGANA',
        'NALGONDA': 'TELANGANA', 'ADILABAD': 'TELANGANA', 'SIDDIPET': 'TELANGANA', 'SURYAPET': 'TELANGANA',
        // Andhra Pradesh cities
        'VISAKHAPATNAM': 'ANDHRA_PRADESH', 'VIZAG': 'ANDHRA_PRADESH', 'VIJAYAWADA': 'ANDHRA_PRADESH', 
        'GUNTUR': 'ANDHRA_PRADESH', 'TIRUPATI': 'ANDHRA_PRADESH', 'NELLORE': 'ANDHRA_PRADESH', 'KAKINADA': 'ANDHRA_PRADESH',
        'RAJAHMUNDRY': 'ANDHRA_PRADESH', 'KURNOOL': 'ANDHRA_PRADESH', 'KADAPA': 'ANDHRA_PRADESH', 'ANANTAPUR': 'ANDHRA_PRADESH',
        'ELURU': 'ANDHRA_PRADESH', 'ONGOLE': 'ANDHRA_PRADESH', 'NANDYAL': 'ANDHRA_PRADESH', 'MACHILIPATNAM': 'ANDHRA_PRADESH',
        'AMARAVATI': 'ANDHRA_PRADESH', 'SRIKAKULAM': 'ANDHRA_PRADESH', 'VIZIANAGARAM': 'ANDHRA_PRADESH',
        // West Bengal cities
        'KOLKATA': 'WEST_BENGAL', 'HOWRAH': 'WEST_BENGAL', 'DURGAPUR': 'WEST_BENGAL', 'ASANSOL': 'WEST_BENGAL', 
        'SILIGURI': 'WEST_BENGAL', 'DARJEELING': 'WEST_BENGAL', 'KHARAGPUR': 'WEST_BENGAL', 'BARDHAMAN': 'WEST_BENGAL',
        'HALDIA': 'WEST_BENGAL', 'MALDA': 'WEST_BENGAL', 'BAHARAMPUR': 'WEST_BENGAL', 'KRISHNANAGAR': 'WEST_BENGAL',
        'DIGHA': 'WEST_BENGAL', 'SUNDARBANS': 'WEST_BENGAL', 'SHANTINIKETAN': 'WEST_BENGAL', 'MURSHIDABAD': 'WEST_BENGAL',
        // Gujarat cities
        'AHMEDABAD': 'GUJARAT', 'SURAT': 'GUJARAT', 'VADODARA': 'GUJARAT', 'RAJKOT': 'GUJARAT', 
        'BHAVNAGAR': 'GUJARAT', 'GANDHINAGAR': 'GUJARAT', 'JAMNAGAR': 'GUJARAT', 'JUNAGADH': 'GUJARAT',
        'ANAND': 'GUJARAT', 'NADIAD': 'GUJARAT', 'BHARUCH': 'GUJARAT', 'MEHSANA': 'GUJARAT',
        'PORBANDAR': 'GUJARAT', 'DWARKA': 'GUJARAT', 'SOMNATH': 'GUJARAT', 'KUTCH': 'GUJARAT',
        'BHUJ': 'GUJARAT', 'GANDHIDHAM': 'GUJARAT', 'MORBI': 'GUJARAT', 'VAPI': 'GUJARAT',
        'NAVSARI': 'GUJARAT', 'GODHRA': 'GUJARAT', 'VERAVAL': 'GUJARAT', 'DAMAN': 'GUJARAT',
        'SAPUTARA': 'GUJARAT', 'STATUE OF UNITY': 'GUJARAT', 'KEVADIA': 'GUJARAT', 'GIR': 'GUJARAT',
        // Rajasthan cities
        'JAIPUR': 'RAJASTHAN', 'JODHPUR': 'RAJASTHAN', 'UDAIPUR': 'RAJASTHAN', 'KOTA': 'RAJASTHAN', 
        'AJMER': 'RAJASTHAN', 'BIKANER': 'RAJASTHAN', 'ALWAR': 'RAJASTHAN', 'BHARATPUR': 'RAJASTHAN',
        'SIKAR': 'RAJASTHAN', 'PALI': 'RAJASTHAN', 'BHILWARA': 'RAJASTHAN', 'JHUNJHUNU': 'RAJASTHAN',
        'JAISALMER': 'RAJASTHAN', 'PUSHKAR': 'RAJASTHAN', 'MOUNT ABU': 'RAJASTHAN', 'CHITTORGARH': 'RAJASTHAN',
        'RANTHAMBORE': 'RAJASTHAN', 'SAWAI MADHOPUR': 'RAJASTHAN', 'BUNDI': 'RAJASTHAN', 'TONK': 'RAJASTHAN',
        // Uttar Pradesh cities (West)
        'LUCKNOW': 'UTTAR_PRADESH_WEST', 'KANPUR': 'UTTAR_PRADESH_WEST', 'AGRA': 'UTTAR_PRADESH_WEST', 
        'MEERUT': 'UTTAR_PRADESH_WEST', 'NOIDA': 'UTTAR_PRADESH_WEST', 'GHAZIABAD': 'UTTAR_PRADESH_WEST',
        'ALIGARH': 'UTTAR_PRADESH_WEST', 'MORADABAD': 'UTTAR_PRADESH_WEST', 'BAREILLY': 'UTTAR_PRADESH_WEST',
        'SAHARANPUR': 'UTTAR_PRADESH_WEST', 'MATHURA': 'UTTAR_PRADESH_WEST', 'VRINDAVAN': 'UTTAR_PRADESH_WEST',
        'FIROZABAD': 'UTTAR_PRADESH_WEST', 'MUZAFFARNAGAR': 'UTTAR_PRADESH_WEST', 'GREATER NOIDA': 'UTTAR_PRADESH_WEST',
        // Uttar Pradesh cities (East)
        'VARANASI': 'UTTAR_PRADESH_EAST', 'ALLAHABAD': 'UTTAR_PRADESH_EAST', 'PRAYAGRAJ': 'UTTAR_PRADESH_EAST', 
        'GORAKHPUR': 'UTTAR_PRADESH_EAST', 'MIRZAPUR': 'UTTAR_PRADESH_EAST', 'JAUNPUR': 'UTTAR_PRADESH_EAST',
        'AYODHYA': 'UTTAR_PRADESH_EAST', 'FAIZABAD': 'UTTAR_PRADESH_EAST', 'AZAMGARH': 'UTTAR_PRADESH_EAST',
        'BASTI': 'UTTAR_PRADESH_EAST', 'SULTANPUR': 'UTTAR_PRADESH_EAST', 'PRATAPGARH': 'UTTAR_PRADESH_EAST',
        // Madhya Pradesh cities
        'BHOPAL': 'MADHYA_PRADESH', 'INDORE': 'MADHYA_PRADESH', 'JABALPUR': 'MADHYA_PRADESH', 
        'GWALIOR': 'MADHYA_PRADESH', 'UJJAIN': 'MADHYA_PRADESH', 'SAGAR': 'MADHYA_PRADESH',
        'DEWAS': 'MADHYA_PRADESH', 'SATNA': 'MADHYA_PRADESH', 'REWA': 'MADHYA_PRADESH', 'RATLAM': 'MADHYA_PRADESH',
        'KHAJURAHO': 'MADHYA_PRADESH', 'SANCHI': 'MADHYA_PRADESH', 'PACHMARHI': 'MADHYA_PRADESH', 'KANHA': 'MADHYA_PRADESH',
        'BANDHAVGARH': 'MADHYA_PRADESH', 'ORCHHA': 'MADHYA_PRADESH', 'MANDU': 'MADHYA_PRADESH', 'OMKARESHWAR': 'MADHYA_PRADESH',
        // Bihar cities
        'PATNA': 'BIHAR', 'GAYA': 'BIHAR', 'BHAGALPUR': 'BIHAR', 'MUZAFFARPUR': 'BIHAR',
        'DARBHANGA': 'BIHAR', 'PURNIA': 'BIHAR', 'ARRAH': 'BIHAR', 'BEGUSARAI': 'BIHAR',
        'KATIHAR': 'BIHAR', 'MUNGER': 'BIHAR', 'CHHAPRA': 'BIHAR', 'BODH GAYA': 'BIHAR',
        'BODHGAYA': 'BIHAR', 'RAJGIR': 'BIHAR', 'NALANDA': 'BIHAR', 'VAISHALI': 'BIHAR',
        // Odisha cities
        'BHUBANESWAR': 'ODISHA', 'CUTTACK': 'ODISHA', 'ROURKELA': 'ODISHA', 'PURI': 'ODISHA',
        'BERHAMPUR': 'ODISHA', 'SAMBALPUR': 'ODISHA', 'BALASORE': 'ODISHA', 'BHADRAK': 'ODISHA',
        'KONARK': 'ODISHA', 'CHILIKA': 'ODISHA', 'GOPALPUR': 'ODISHA', 'PARADIP': 'ODISHA',
        // Punjab cities
        'CHANDIGARH': 'PUNJAB', 'LUDHIANA': 'PUNJAB', 'AMRITSAR': 'PUNJAB', 'JALANDHAR': 'PUNJAB', 
        'PATIALA': 'PUNJAB', 'BATHINDA': 'PUNJAB', 'MOHALI': 'PUNJAB', 'PATHANKOT': 'PUNJAB',
        'HOSHIARPUR': 'PUNJAB', 'MOGA': 'PUNJAB', 'FIROZPUR': 'PUNJAB', 'RUPNAGAR': 'PUNJAB',
        'GOLDEN TEMPLE': 'PUNJAB', 'WAGAH': 'PUNJAB',
        // Kerala cities
        'KOCHI': 'KERALA', 'COCHIN': 'KERALA', 'THIRUVANANTHAPURAM': 'KERALA', 'TRIVANDRUM': 'KERALA', 
        'KOZHIKODE': 'KERALA', 'CALICUT': 'KERALA', 'THRISSUR': 'KERALA', 'KOLLAM': 'KERALA',
        'KANNUR': 'KERALA', 'ALAPPUZHA': 'KERALA', 'ALLEPPEY': 'KERALA', 'PALAKKAD': 'KERALA',
        'MALAPPURAM': 'KERALA', 'KOTTAYAM': 'KERALA', 'MUNNAR': 'KERALA', 'THEKKADY': 'KERALA',
        'WAYANAD': 'KERALA', 'KUMARAKOM': 'KERALA', 'VARKALA': 'KERALA', 'KOVALAM': 'KERALA',
        'BEKAL': 'KERALA', 'GURUVAYUR': 'KERALA', 'SABARIMALA': 'KERALA',
        // Assam cities
        'GUWAHATI': 'ASSAM', 'SILCHAR': 'ASSAM', 'DIBRUGARH': 'ASSAM', 'JORHAT': 'ASSAM',
        'NAGAON': 'ASSAM', 'TINSUKIA': 'ASSAM', 'TEZPUR': 'ASSAM', 'BONGAIGAON': 'ASSAM',
        'KAZIRANGA': 'ASSAM', 'MAJULI': 'ASSAM', 'MANAS': 'ASSAM',
        // Jharkhand cities
        'RANCHI': 'JHARKHAND', 'JAMSHEDPUR': 'JHARKHAND', 'DHANBAD': 'JHARKHAND', 'BOKARO': 'JHARKHAND',
        'HAZARIBAGH': 'JHARKHAND', 'DEOGHAR': 'JHARKHAND', 'GIRIDIH': 'JHARKHAND', 'RAMGARH': 'JHARKHAND',
        // Chhattisgarh cities
        'RAIPUR': 'CHHATTISGARH', 'BILASPUR': 'CHHATTISGARH', 'DURG': 'CHHATTISGARH', 'BHILAI': 'CHHATTISGARH',
        'KORBA': 'CHHATTISGARH', 'RAJNANDGAON': 'CHHATTISGARH', 'JAGDALPUR': 'CHHATTISGARH', 'AMBIKAPUR': 'CHHATTISGARH',
        // Uttarakhand cities
        'DEHRADUN': 'UTTARAKHAND', 'HARIDWAR': 'UTTARAKHAND', 'RISHIKESH': 'UTTARAKHAND', 'NAINITAL': 'UTTARAKHAND', 
        'MUSSOORIE': 'UTTARAKHAND', 'HALDWANI': 'UTTARAKHAND', 'ROORKEE': 'UTTARAKHAND', 'KASHIPUR': 'UTTARAKHAND',
        'RUDRAPUR': 'UTTARAKHAND', 'ALMORA': 'UTTARAKHAND', 'PITHORAGARH': 'UTTARAKHAND', 'CHAMOLI': 'UTTARAKHAND',
        'BADRINATH': 'UTTARAKHAND', 'KEDARNATH': 'UTTARAKHAND', 'GANGOTRI': 'UTTARAKHAND', 'YAMUNOTRI': 'UTTARAKHAND',
        'JIM CORBETT': 'UTTARAKHAND', 'CORBETT': 'UTTARAKHAND', 'AULI': 'UTTARAKHAND', 'VALLEY OF FLOWERS': 'UTTARAKHAND',
        // Himachal Pradesh cities
        'SHIMLA': 'HIMACHAL_PRADESH', 'MANALI': 'HIMACHAL_PRADESH', 'DHARAMSHALA': 'HIMACHAL_PRADESH', 
        'KULLU': 'HIMACHAL_PRADESH', 'DALHOUSIE': 'HIMACHAL_PRADESH', 'MCLEODGANJ': 'HIMACHAL_PRADESH',
        'KASOL': 'HIMACHAL_PRADESH', 'SPITI': 'HIMACHAL_PRADESH', 'KINNAUR': 'HIMACHAL_PRADESH', 'CHAMBA': 'HIMACHAL_PRADESH',
        'SOLAN': 'HIMACHAL_PRADESH', 'MANDI': 'HIMACHAL_PRADESH', 'PALAMPUR': 'HIMACHAL_PRADESH', 'KANGRA': 'HIMACHAL_PRADESH',
        // Jammu & Kashmir cities
        'SRINAGAR': 'JAMMU_KASHMIR', 'JAMMU': 'JAMMU_KASHMIR', 'LEH': 'JAMMU_KASHMIR', 'LADAKH': 'JAMMU_KASHMIR',
        'GULMARG': 'JAMMU_KASHMIR', 'PAHALGAM': 'JAMMU_KASHMIR', 'SONAMARG': 'JAMMU_KASHMIR', 'KATRA': 'JAMMU_KASHMIR',
        'VAISHNO DEVI': 'JAMMU_KASHMIR', 'PATNITOP': 'JAMMU_KASHMIR', 'ANANTNAG': 'JAMMU_KASHMIR', 'BARAMULLA': 'JAMMU_KASHMIR',
        'NUBRA': 'JAMMU_KASHMIR', 'PANGONG': 'JAMMU_KASHMIR', 'KARGIL': 'JAMMU_KASHMIR', 'ZANSKAR': 'JAMMU_KASHMIR',
        // Haryana cities
        'GURGAON': 'HARYANA', 'GURUGRAM': 'HARYANA', 'FARIDABAD': 'HARYANA', 'PANIPAT': 'HARYANA', 
        'AMBALA': 'HARYANA', 'KARNAL': 'HARYANA', 'ROHTAK': 'HARYANA', 'HISAR': 'HARYANA',
        'SONIPAT': 'HARYANA', 'YAMUNANAGAR': 'HARYANA', 'KURUKSHETRA': 'HARYANA', 'PANCHKULA': 'HARYANA',
        'REWARI': 'HARYANA', 'BHIWANI': 'HARYANA', 'SIRSA': 'HARYANA', 'JIND': 'HARYANA',
        // North East I cities
        'IMPHAL': 'NORTH_EAST_I', 'SHILLONG': 'NORTH_EAST_I', 'AIZAWL': 'NORTH_EAST_I', 'KOHIMA': 'NORTH_EAST_I',
        'MANIPUR': 'NORTH_EAST_I', 'MEGHALAYA': 'NORTH_EAST_I', 'MIZORAM': 'NORTH_EAST_I', 'NAGALAND': 'NORTH_EAST_I',
        'CHERRAPUNJI': 'NORTH_EAST_I', 'MAWLYNNONG': 'NORTH_EAST_I', 'DAWKI': 'NORTH_EAST_I', 'LOKTAK': 'NORTH_EAST_I',
        // North East II cities
        'AGARTALA': 'NORTH_EAST_II', 'ITANAGAR': 'NORTH_EAST_II', 'GANGTOK': 'NORTH_EAST_II',
        'TRIPURA': 'NORTH_EAST_II', 'ARUNACHAL': 'NORTH_EAST_II', 'SIKKIM': 'NORTH_EAST_II',
        'TAWANG': 'NORTH_EAST_II', 'PELLING': 'NORTH_EAST_II', 'LACHUNG': 'NORTH_EAST_II', 'YUMTHANG': 'NORTH_EAST_II',
        // Andaman & Nicobar
        'PORT BLAIR': 'ANDAMAN_NICOBAR', 'PORTBLAIR': 'ANDAMAN_NICOBAR', 'HAVELOCK': 'ANDAMAN_NICOBAR',
        'NEIL ISLAND': 'ANDAMAN_NICOBAR', 'BARATANG': 'ANDAMAN_NICOBAR', 'ROSS ISLAND': 'ANDAMAN_NICOBAR',
        'CELLULAR JAIL': 'ANDAMAN_NICOBAR', 'RADHANAGAR': 'ANDAMAN_NICOBAR',
      };
      
      const categoryMapping: Record<string, string> = {
        'CULTURAL': 'Cultural', 'CULTURE': 'Cultural',
        'RELIGIOUS': 'Religious', 'RELIGION': 'Religious',
        'SPORTS': 'Sports', 'SPORT': 'Sports', 'SPORTING': 'Sports',
        'EXHIBITION': 'Exhibition', 'EXPO': 'Exhibition',
        'FAIR': 'Fair', 'FAIRS': 'Fair', 'MELA': 'Fair',
        'FESTIVAL': 'Festival', 'FESTIVALS': 'Festival', 'FEST': 'Festival',
        'AGRI-TOURISM': 'Agri-Tourism', 'AGRITOURISM': 'Agri-Tourism', 'AGRI': 'Agri-Tourism', 'AGRICULTURE': 'Agri-Tourism',
        'ECO-TOURISM': 'Eco-Tourism', 'ECOTOURISM': 'Eco-Tourism', 'ECO': 'Eco-Tourism',
        'TRADE/RELIGIOUS': 'Trade/Religious', 'TRADE': 'Trade/Religious', 'TRADE_RELIGIOUS': 'Trade/Religious',
        'RELIGIOUS/FAIR': 'Trade/Religious', 'FAIR/RELIGIOUS': 'Trade/Religious',
        'CULTURAL_/_MUSIC': 'Cultural', 'CULTURAL/MUSIC': 'Cultural', 'MUSIC': 'Cultural',
        'RURAL_SPORT': 'Sports', 'RURAL SPORT': 'Sports', 'RURAL_SPORT_/_PUBLIC_GATHERING': 'Sports',
        'PUBLIC_GATHERING': 'Fair', 'PUBLIC GATHERING': 'Fair', 'GATHERING': 'Fair',
        'FESTIVAL_/_PUBLIC_GATHERING': 'Festival', 'FESTIVAL/PUBLIC_GATHERING': 'Festival',
        'PUBLIC_GATHERING_/_PARADE': 'Fair', 'PARADE': 'Fair',
        'MUSIC_FESTIVAL': 'Festival', 'MUSIC FESTIVAL': 'Festival',
        'SPORTS_/_PUBLIC_GATHERING': 'Sports', 'SPORTS/PUBLIC_GATHERING': 'Sports',
        'TRADE_/_INDUSTRY_EXPO': 'Exhibition', 'TRADE/INDUSTRY_EXPO': 'Exhibition', 'INDUSTRY_EXPO': 'Exhibition', 'INDUSTRY EXPO': 'Exhibition',
      };
      
      // Function to extract base category (handles "Sports (Wrestling)" → "Sports")
      const extractBaseCategory = (cat: string): string => {
        return cat.replace(/\s*\([^)]*\)\s*/g, '').trim();
      };
      
      const detectCircleFromLocation = (location: string): string | undefined => {
        const locationUpper = location.toUpperCase().replace(/[,\s]+/g, ' ').trim();
        
        // First check dynamic mapping from employee_master (zones like "Jalgaon", "PUNE", etc.)
        for (const [zone, circle] of Object.entries(zoneToCircle)) {
          if (locationUpper.includes(zone) || zone.includes(locationUpper)) {
            return circle;
          }
        }
        
        // Then check static city mapping as fallback
        for (const [city, circle] of Object.entries(locationToCircle)) {
          if (locationUpper.includes(city)) {
            return circle;
          }
        }
        return undefined;
      };
      
      for (const record of input.data) {
        const rowLabel = record.rowNumber ? `Row ${record.rowNumber}` : `"${record.name}"`;
        try {
          let circle: string | undefined;
          
          if (record.circle && record.circle.trim()) {
            const circleKey = record.circle.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
            circle = circleMapping[circleKey];
          }
          
          if (!circle) {
            circle = detectCircleFromLocation(record.location);
          }
          
          if (!circle) {
            errors.push(`${rowLabel}: Could not detect circle from location "${record.location}". Please add Circle column with state name (e.g., MAHARASHTRA, KARNATAKA)`);
            continue;
          }
          
          // Try to match category - handle "Sports (Wrestling)" → "Sports"
          const rawCategory = record.category.trim();
          const baseCategory = extractBaseCategory(rawCategory);
          const categoryKey = baseCategory.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
          let category: string | undefined = categoryMapping[categoryKey];
          
          if (!category) {
            // Try with raw category key
            const rawKey = rawCategory.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
            category = categoryMapping[rawKey];
          }
          
          if (!category) {
            category = validCategories.find(c => c.toLowerCase() === baseCategory.toLowerCase());
          }
          
          if (!category) {
            category = validCategories.find(c => c.toLowerCase() === rawCategory.toLowerCase());
          }
          
          if (!category) {
            errors.push(`${rowLabel}: Invalid category "${record.category}". Valid: ${validCategories.join(', ')}`);
            continue;
          }
          
          const startDate = new Date(record.startDate);
          const endDate = new Date(record.endDate);
          
          if (isNaN(startDate.getTime())) {
            errors.push(`${rowLabel}: Invalid start date format`);
            continue;
          }
          
          if (isNaN(endDate.getTime())) {
            errors.push(`${rowLabel}: Invalid end date format`);
            continue;
          }
          
          if (endDate < startDate) {
            errors.push(`${rowLabel}: End date cannot be before start date`);
            continue;
          }
          
          const nameTrimmed = record.name.trim().substring(0, 255);
          const locationTrimmed = record.location.trim();
          
          const existing = await db.select().from(events)
            .where(and(
              eq(events.name, nameTrimmed),
              eq(events.location, locationTrimmed),
              eq(events.circle, circle as any)
            ));
          
          if (existing[0]) {
            await db.update(events)
              .set({
                startDate,
                endDate,
                category: category as any,
                keyInsight: record.keyInsight?.trim() || null,
                zone: record.zone?.trim() || existing[0].zone || 'Default',
                updatedAt: new Date(),
              })
              .where(eq(events.id, existing[0].id));
            updated++;
          } else {
            await db.insert(events).values({
              name: nameTrimmed,
              location: locationTrimmed,
              circle: circle as any,
              zone: record.zone?.trim() || 'Default',
              startDate,
              endDate,
              category: category as any,
              keyInsight: record.keyInsight?.trim() || null,
              status: 'draft',
              targetSim: 0,
              targetFtth: 0,
              allocatedSim: 0,
              allocatedFtth: 0,
              createdBy: input.uploadedBy,
            });
            imported++;
          }
        } catch (error: any) {
          errors.push(`${rowLabel}: ${error.message}`);
        }
      }
      
      await db.insert(auditLogs).values({
        action: 'IMPORT_EVENTS',
        entityType: 'EVENT',
        entityId: input.uploadedBy,
        performedBy: input.uploadedBy,
        details: { imported, updated, errors: errors.length, totalRecords: input.data.length },
      });
      
      console.log(`Events import complete: ${imported} imported, ${updated} updated, ${errors.length} errors`);
      
      return { imported, updated, errors };
    }),

  getEventStats: publicProcedure
    .query(async () => {
      const total = await db.select({ count: sql<number>`count(*)` }).from(events);
      const active = await db.select({ count: sql<number>`count(*)` })
        .from(events)
        .where(eq(events.status, 'active'));
      const draft = await db.select({ count: sql<number>`count(*)` })
        .from(events)
        .where(eq(events.status, 'draft'));
      
      return {
        total: Number(total[0]?.count || 0),
        active: Number(active[0]?.count || 0),
        draft: Number(draft[0]?.count || 0),
      };
    }),

  getFullHierarchy: publicProcedure
    .input(z.object({
      persNo: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const linkedEmployeeCache = new Map<string, any>();
        
        const batchFetchLinkedEmployees = async (linkedIds: string[]) => {
          const uncachedIds = linkedIds.filter(id => !linkedEmployeeCache.has(id));
          if (uncachedIds.length > 0) {
            const linkedEmps = await db.select().from(employees)
              .where(inArray(employees.id, uncachedIds));
            linkedEmps.forEach(emp => linkedEmployeeCache.set(emp.id, emp));
          }
        };

        const getManagerChain = async (persNo: string, visited: Set<string> = new Set()): Promise<any[]> => {
          if (visited.has(persNo)) {
            console.warn(`Cycle detected in hierarchy at persNo: ${persNo}`);
            return [];
          }
          visited.add(persNo);
          
          const current = await db.select().from(employeeMaster)
            .where(eq(employeeMaster.persNo, persNo));
          
          if (!current[0]) return [];
          
          const emp = current[0];
          if (emp.linkedEmployeeId) {
            await batchFetchLinkedEmployees([emp.linkedEmployeeId]);
          }
          const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeCache.get(emp.linkedEmployeeId) : null;
          
          const node = {
            id: emp.id,
            persNo: emp.persNo,
            name: emp.name,
            designation: emp.designation,
            circle: emp.circle,
            zone: emp.zone,
            division: emp.division,
            officeName: emp.officeName,
            sortOrder: emp.sortOrder,
            reportingPersNo: emp.reportingPersNo,
            isLinked: emp.isLinked,
            linkedEmployee: linkedEmployee ? {
              id: linkedEmployee.id,
              email: linkedEmployee.email,
              phone: linkedEmployee.phone,
              role: linkedEmployee.role,
            } : null,
          };
          
          if (emp.reportingPersNo) {
            const managers = await getManagerChain(emp.reportingPersNo, visited);
            return [node, ...managers];
          }
          
          return [node];
        };

        const getSubordinates = async (
          persNo: string, 
          depth: number = 0, 
          maxDepth: number = 3,
          visited: Set<string> = new Set()
        ): Promise<any[]> => {
          if (depth >= maxDepth) return [];
          if (visited.has(persNo)) {
            console.warn(`Cycle detected in subordinates at persNo: ${persNo}`);
            return [];
          }
          visited.add(persNo);
          
          const directReports = await db.select().from(employeeMaster)
            .where(eq(employeeMaster.reportingPersNo, persNo))
            .orderBy(desc(employeeMaster.sortOrder));
          
          if (directReports.length === 0) return [];
          
          const linkedIds = directReports
            .filter(emp => emp.linkedEmployeeId)
            .map(emp => emp.linkedEmployeeId!);
          await batchFetchLinkedEmployees(linkedIds);
          
          const directReportPurseIds = directReports.map(emp => emp.persNo);
          const countResults = await db.select({
            reportingPersNo: employeeMaster.reportingPersNo,
            count: sql<number>`count(*)`,
          })
            .from(employeeMaster)
            .where(inArray(employeeMaster.reportingPersNo, directReportPurseIds))
            .groupBy(employeeMaster.reportingPersNo);
          
          const countMap = new Map(countResults.map(r => [r.reportingPersNo, Number(r.count)]));
          
          const subordinates = await Promise.all(directReports.map(async (emp) => {
            const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeCache.get(emp.linkedEmployeeId) : null;
            const children = await getSubordinates(emp.persNo, depth + 1, maxDepth, visited);
            
            return {
              id: emp.id,
              persNo: emp.persNo,
              name: emp.name,
              designation: emp.designation,
              circle: emp.circle,
              zone: emp.zone,
              division: emp.division,
              officeName: emp.officeName,
              sortOrder: emp.sortOrder,
              reportingPersNo: emp.reportingPersNo,
              isLinked: emp.isLinked,
              linkedEmployee: linkedEmployee ? {
                id: linkedEmployee.id,
                email: linkedEmployee.email,
                phone: linkedEmployee.phone,
                role: linkedEmployee.role,
              } : null,
              directReportsCount: countMap.get(emp.persNo) || 0,
              children: children,
            };
          }));
          
          return subordinates;
        };

        const current = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.persNo, input.persNo));
        
        if (!current[0]) {
          return { managers: [], currentUser: null, subordinates: [] };
        }
        
        const emp = current[0];
        if (emp.linkedEmployeeId) {
          await batchFetchLinkedEmployees([emp.linkedEmployeeId]);
        }
        const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeCache.get(emp.linkedEmployeeId) : null;
        
        const directReportsCount = await db.select({ count: sql<number>`count(*)` })
          .from(employeeMaster)
          .where(eq(employeeMaster.reportingPersNo, emp.persNo));
        
        const currentUser = {
          id: emp.id,
          persNo: emp.persNo,
          name: emp.name,
          designation: emp.designation,
          circle: emp.circle,
          zone: emp.zone,
          division: emp.division,
          officeName: emp.officeName,
          sortOrder: emp.sortOrder,
          reportingPersNo: emp.reportingPersNo,
          isLinked: emp.isLinked,
          linkedEmployee: linkedEmployee ? {
            id: linkedEmployee.id,
            email: linkedEmployee.email,
            phone: linkedEmployee.phone,
            role: linkedEmployee.role,
          } : null,
          directReportsCount: Number(directReportsCount[0]?.count || 0),
        };
        
        let managers: any[] = [];
        if (emp.reportingPersNo) {
          managers = await getManagerChain(emp.reportingPersNo);
        }
        
        const subordinates = await getSubordinates(input.persNo);
        
        return { managers, currentUser, subordinates };
      } catch (error) {
        console.error('Error fetching hierarchy:', error);
        throw new Error('Failed to fetch organization hierarchy. Please try again.');
      }
    }),

  getSubordinatesPage: publicProcedure
    .input(z.object({
      persNo: z.string(),
      page: z.number().default(1),
      limit: z.number().default(20),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const offset = (input.page - 1) * input.limit;
        
        const directReports = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.reportingPersNo, input.persNo))
          .orderBy(desc(employeeMaster.sortOrder))
          .limit(input.limit)
          .offset(offset);
        
        const totalCount = await db.select({ count: sql<number>`count(*)` })
          .from(employeeMaster)
          .where(eq(employeeMaster.reportingPersNo, input.persNo));
        
        if (directReports.length === 0) {
          return {
            subordinates: [],
            total: 0,
            page: input.page,
            totalPages: 0,
          };
        }
        
        const linkedIds = directReports
          .filter(emp => emp.linkedEmployeeId)
          .map(emp => emp.linkedEmployeeId!);
        
        const linkedEmployeeMap = new Map<string, any>();
        if (linkedIds.length > 0) {
          const linkedEmps = await db.select().from(employees)
            .where(inArray(employees.id, linkedIds));
          linkedEmps.forEach(emp => linkedEmployeeMap.set(emp.id, emp));
        }
        
        const persNos = directReports.map(emp => emp.persNo);
        const countResults = await db.select({
          reportingPersNo: employeeMaster.reportingPersNo,
          count: sql<number>`count(*)`,
        })
          .from(employeeMaster)
          .where(inArray(employeeMaster.reportingPersNo, persNos))
          .groupBy(employeeMaster.reportingPersNo);
        
        const countMap = new Map(countResults.map(r => [r.reportingPersNo, Number(r.count)]));
        
        const subordinates = directReports.map((emp) => {
          const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeMap.get(emp.linkedEmployeeId) : null;
          
          return {
            id: emp.id,
            persNo: emp.persNo,
            name: emp.name,
            designation: emp.designation,
            circle: emp.circle,
            zone: emp.zone,
            division: emp.division,
            officeName: emp.officeName,
            sortOrder: emp.sortOrder,
            isLinked: emp.isLinked,
            linkedEmployee: linkedEmployee ? {
              id: linkedEmployee.id,
              email: linkedEmployee.email,
              phone: linkedEmployee.phone,
              role: linkedEmployee.role,
            } : null,
            directReportsCount: countMap.get(emp.persNo) || 0,
          };
        });
        
        return {
          subordinates,
          total: Number(totalCount[0]?.count || 0),
          page: input.page,
          totalPages: Math.ceil(Number(totalCount[0]?.count || 0) / input.limit),
        };
      } catch (error) {
        console.error('Error fetching subordinates page:', error);
        throw new Error('Failed to fetch team members. Please try again.');
      }
    }),

  searchHierarchy: publicProcedure
    .input(z.object({
      persNo: z.string(),
      searchQuery: z.string().min(2),
    }))
    .query(async ({ input }) => {
      try {
        const getAllSubordinatePurseIds = async (persNo: string, visited: Set<string> = new Set(), depth: number = 0): Promise<string[]> => {
          if (visited.has(persNo) || depth > 10) return [];
          visited.add(persNo);
          
          const directReports = await db.select({ persNo: employeeMaster.persNo })
            .from(employeeMaster)
            .where(eq(employeeMaster.reportingPersNo, persNo));
          
          const allIds = [persNo];
          for (const report of directReports) {
            const childIds = await getAllSubordinatePurseIds(report.persNo, visited, depth + 1);
            allIds.push(...childIds);
          }
          return allIds;
        };

        const subordinatePurseIds = await getAllSubordinatePurseIds(input.persNo);
        
        const searchPattern = `%${input.searchQuery}%`;
        const results = await db.select().from(employeeMaster)
          .where(sql`(${employeeMaster.name} ILIKE ${searchPattern} OR ${employeeMaster.persNo} ILIKE ${searchPattern}) AND ${employeeMaster.persNo} = ANY(${subordinatePurseIds})`)
          .orderBy(desc(employeeMaster.sortOrder))
          .limit(50);
        
        if (results.length === 0) return [];
        
        const linkedIds = results
          .filter(emp => emp.linkedEmployeeId)
          .map(emp => emp.linkedEmployeeId!);
        
        const linkedEmployeeMap = new Map<string, any>();
        if (linkedIds.length > 0) {
          const linkedEmps = await db.select().from(employees)
            .where(inArray(employees.id, linkedIds));
          linkedEmps.forEach(emp => linkedEmployeeMap.set(emp.id, emp));
        }
        
        const employees_result = results.map((emp) => {
          const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeMap.get(emp.linkedEmployeeId) : null;
          
          return {
            id: emp.id,
            persNo: emp.persNo,
            name: emp.name,
            designation: emp.designation,
            circle: emp.circle,
            zone: emp.zone,
            sortOrder: emp.sortOrder,
            isLinked: emp.isLinked,
            linkedEmployee: linkedEmployee ? {
              id: linkedEmployee.id,
              email: linkedEmployee.email,
              phone: linkedEmployee.phone,
            } : null,
          };
        });
        
        return employees_result;
      } catch (error) {
        console.error('Error searching hierarchy:', error);
        throw new Error('Failed to search team members. Please try again.');
      }
    }),

  getTwoLevelSubordinates: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      try {
        console.log("Fetching 2-level subordinates for:", input.employeeId);
        
        const employee = await db.select().from(employees)
          .where(eq(employees.id, input.employeeId));
        
        if (!employee[0]?.persNo) {
          return { subordinates: [], managerPurseId: null };
        }
        
        const managerPurseId = employee[0].persNo;
        
        // Get Level 1 subordinates (direct reports)
        const level1Reports = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.reportingPersNo, managerPurseId))
          .orderBy(desc(employeeMaster.sortOrder));
        
        // Get Level 2 subordinates (reports of direct reports)
        const level1PurseIds = level1Reports.map(r => r.persNo);
        let level2Reports: typeof level1Reports = [];
        
        if (level1PurseIds.length > 0) {
          level2Reports = await db.select().from(employeeMaster)
            .where(inArray(employeeMaster.reportingPersNo, level1PurseIds))
            .orderBy(desc(employeeMaster.sortOrder));
        }
        
        // Get linked employee details for all
        const allLinkedIds = [...level1Reports, ...level2Reports]
          .filter(r => r.linkedEmployeeId)
          .map(r => r.linkedEmployeeId!);
        
        const linkedEmployeeMap = new Map<string, any>();
        if (allLinkedIds.length > 0) {
          const linkedEmps = await db.select().from(employees)
            .where(inArray(employees.id, allLinkedIds));
          linkedEmps.forEach(emp => linkedEmployeeMap.set(emp.id, emp));
        }
        
        // Get subordinate counts for each employee
        const allPurseIds = [...level1PurseIds, ...level2Reports.map(r => r.persNo)];
        const countMap = new Map<string, number>();
        
        if (allPurseIds.length > 0) {
          const countResults = await db.select({
            reportingPersNo: employeeMaster.reportingPersNo,
            count: sql<number>`count(*)`,
          })
            .from(employeeMaster)
            .where(inArray(employeeMaster.reportingPersNo, allPurseIds))
            .groupBy(employeeMaster.reportingPersNo);
          
          countResults.forEach(r => countMap.set(r.reportingPersNo!, Number(r.count)));
        }
        
        // Format subordinates with hierarchy structure
        const formatSubordinate = (emp: typeof level1Reports[0], level: number) => {
          const linkedEmployee = emp.linkedEmployeeId ? linkedEmployeeMap.get(emp.linkedEmployeeId) : null;
          return {
            id: emp.id,
            persNo: emp.persNo,
            name: emp.name,
            designation: emp.designation,
            circle: emp.circle,
            zone: emp.zone,
            division: emp.division,
            officeName: emp.officeName,
            isLinked: emp.isLinked,
            level,
            reportingPersNo: emp.reportingPersNo,
            linkedEmployee: linkedEmployee ? {
              id: linkedEmployee.id,
              email: linkedEmployee.email,
              phone: linkedEmployee.phone,
              role: linkedEmployee.role,
            } : null,
            directReportsCount: countMap.get(emp.persNo) || 0,
          };
        };
        
        // Build hierarchical structure
        const level1Formatted = level1Reports.map(emp => ({
          ...formatSubordinate(emp, 1),
          subordinates: level2Reports
            .filter(l2 => l2.reportingPersNo === emp.persNo)
            .map(l2 => formatSubordinate(l2, 2)),
        }));
        
        console.log(`Found ${level1Reports.length} level-1 and ${level2Reports.length} level-2 subordinates`);
        
        return {
          subordinates: level1Formatted,
          managerPurseId,
          totalCount: level1Reports.length + level2Reports.length,
        };
      } catch (error) {
        console.error('Error fetching 2-level subordinates:', error);
        throw new Error('Failed to fetch team hierarchy. Please try again.');
      }
    }),

  bulkActivateEmployees: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
      adminId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("=== BULK ACTIVATE EMPLOYEES ===");
      console.log("Circle filter:", input.circle || "All circles");
      
      // Server-side role validation: Only ADMIN can bulk activate
      const admin = await db.select().from(employees).where(eq(employees.id, input.adminId)).limit(1);
      if (admin[0]?.role !== 'ADMIN') {
        throw new Error('Only admin users can bulk activate employees. Access denied.');
      }
      
      let unlinkedQuery = db.select().from(employeeMaster)
        .where(isNull(employeeMaster.linkedEmployeeId));
      
      if (input.circle) {
        unlinkedQuery = db.select().from(employeeMaster)
          .where(and(
            isNull(employeeMaster.linkedEmployeeId),
            eq(employeeMaster.circle, input.circle)
          ));
      }
      
      const unlinkedEmployees = await unlinkedQuery;
      console.log(`Found ${unlinkedEmployees.length} unlinked employees to activate`);
      
      let activated = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      const generateDefaultPassword = (persNo: string): string => {
        const last4 = persNo.slice(-4).padStart(4, '0');
        return `BSNL@${last4}`;
      };
      
      const mapCircleToEnum = (circle: string | null): string => {
        if (!circle) return 'KARNATAKA';
        const circleMap: Record<string, string> = {
          'ANDAMAN_NICOBAR': 'ANDAMAN_NICOBAR',
          'ANDHRA_PRADESH': 'ANDHRA_PRADESH',
          'ASSAM': 'ASSAM',
          'BIHAR': 'BIHAR',
          'CHHATTISGARH': 'CHHATTISGARH',
          'GUJARAT': 'GUJARAT',
          'HARYANA': 'HARYANA',
          'HIMACHAL_PRADESH': 'HIMACHAL_PRADESH',
          'JAMMU_KASHMIR': 'JAMMU_KASHMIR',
          'JHARKHAND': 'JHARKHAND',
          'KARNATAKA': 'KARNATAKA',
          'KERALA': 'KERALA',
          'MADHYA_PRADESH': 'MADHYA_PRADESH',
          'MAHARASHTRA': 'MAHARASHTRA',
          'NORTH_EAST_I': 'NORTH_EAST_I',
          'NORTH_EAST_II': 'NORTH_EAST_II',
          'ODISHA': 'ODISHA',
          'PUNJAB': 'PUNJAB',
          'RAJASTHAN': 'RAJASTHAN',
          'TAMIL_NADU': 'TAMIL_NADU',
          'TELANGANA': 'TELANGANA',
          'UTTARAKHAND': 'UTTARAKHAND',
          'UTTAR_PRADESH_EAST': 'UTTAR_PRADESH_EAST',
          'UTTAR_PRADESH_WEST': 'UTTAR_PRADESH_WEST',
          'WEST_BENGAL': 'WEST_BENGAL',
        };
        
        const normalized = circle.toUpperCase().replace(/[\s-]+/g, '_');
        return circleMap[normalized] || 'KARNATAKA';
      };
      
      const mapDesignationToRole = (designation: string | null): 'GM' | 'CGM' | 'DGM' | 'AGM' | 'SD_JTO' | 'SALES_STAFF' => {
        if (!designation) return 'SALES_STAFF';
        const upper = designation.toUpperCase();
        if (upper.includes('GM') && !upper.includes('AGM') && !upper.includes('DGM') && !upper.includes('CGM')) return 'GM';
        if (upper.includes('CGM')) return 'CGM';
        if (upper.includes('DGM')) return 'DGM';
        if (upper.includes('AGM')) return 'AGM';
        if (upper.includes('JTO') || upper.includes('SDE')) return 'SD_JTO';
        return 'SALES_STAFF';
      };
      
      for (const emp of unlinkedEmployees) {
        try {
          const existingEmployee = await db.select().from(employees)
            .where(eq(employees.persNo, emp.persNo));
          
          if (existingEmployee.length > 0) {
            await db.update(employeeMaster)
              .set({ 
                linkedEmployeeId: existingEmployee[0].id,
                updatedAt: new Date()
              })
              .where(eq(employeeMaster.id, emp.id));
            skipped++;
            continue;
          }
          
          const password = generateDefaultPassword(emp.persNo);
          const role = mapDesignationToRole(emp.designation);
          
          const newEmployee = await db.insert(employees).values({
            name: emp.name,
            email: null,
            phone: null,
            password: password,
            role: role,
            circle: emp.circle || 'Unknown',
            zone: emp.zone || 'Default',
            persNo: emp.persNo,
            designation: emp.designation || 'Staff',
            isActive: true,
            needsPasswordChange: true,
          }).returning();
          
          await db.update(employeeMaster)
            .set({ 
              linkedEmployeeId: newEmployee[0].id,
              isLinked: true,
              linkedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(employeeMaster.id, emp.id));
          
          activated++;
        } catch (error: any) {
          errors.push(`${emp.persNo}: ${error.message}`);
        }
      }
      
      await db.insert(auditLogs).values({
        action: 'BULK_ACTIVATE_EMPLOYEES',
        entityType: 'EMPLOYEE',
        entityId: input.adminId,
        performedBy: input.adminId,
        details: { 
          circle: input.circle || 'All', 
          activated, 
          skipped,
          errors: errors.length 
        },
      });
      
      console.log(`Bulk activation complete: ${activated} activated, ${skipped} skipped, ${errors.length} errors`);
      
      return { 
        activated, 
        skipped, 
        errors,
        passwordFormula: "BSNL@ + last 4 digits of Pers No padded with zeros (e.g., Pers No 198012345 → BSNL@2345, Pers No 223 → BSNL@0223)"
      };
    }),

  getCirclesWithUnlinkedCount: publicProcedure
    .query(async () => {
      const result = await db.execute(sql`
        SELECT 
          COALESCE(circle, 'Unknown') as circle,
          COUNT(*) as count
        FROM employee_master
        WHERE linked_employee_id IS NULL
        GROUP BY circle
        ORDER BY count DESC
      `);
      
      return result as unknown as { circle: string; count: string }[];
    }),

  getOutstandingSummary: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("getOutstandingSummary called with input:", input);
      let whereClause = sql`1=1`;
      
      if (input?.circle) {
        whereClause = sql`circle = ${input.circle}`;
      }
      
      // Note: Database values were imported with 100× inflation (10^9 instead of 10^7)
      // Apply correction factor of 100 to get accurate amounts
      const CORRECTION_FACTOR = 100;
      
      const ftthResult = await db.execute(sql`
        SELECT 
          COUNT(*) as employee_count,
          COALESCE(SUM(CAST(outstanding_ftth AS NUMERIC)), 0) / ${CORRECTION_FACTOR} as total_amount
        FROM employees
        WHERE outstanding_ftth IS NOT NULL 
          AND CAST(outstanding_ftth AS NUMERIC) > 0
          AND ${whereClause}
      `);
      
      const lcResult = await db.execute(sql`
        SELECT 
          COUNT(*) as employee_count,
          COALESCE(SUM(CAST(outstanding_lc AS NUMERIC)), 0) / ${CORRECTION_FACTOR} as total_amount
        FROM employees
        WHERE outstanding_lc IS NOT NULL 
          AND CAST(outstanding_lc AS NUMERIC) > 0
          AND ${whereClause}
      `);
      
      const ftthData = (ftthResult as any)[0] || { employee_count: '0', total_amount: '0' };
      const lcData = (lcResult as any)[0] || { employee_count: '0', total_amount: '0' };
      
      console.log("Outstanding Summary - FTTH:", ftthData, "LC:", lcData);
      
      return {
        ftth: {
          totalAmount: ftthData.total_amount?.toString() || '0',
          employeeCount: parseInt(ftthData.employee_count || '0'),
        },
        lc: {
          totalAmount: lcData.total_amount?.toString() || '0',
          employeeCount: parseInt(lcData.employee_count || '0'),
        },
      };
    }),

  getOutstandingEmployees: publicProcedure
    .input(z.object({
      type: z.enum(['ftth', 'lc']),
      circle: z.string().optional(),
      limit: z.number().optional().default(100),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ input }) => {
      const column = input.type === 'ftth' ? 'outstanding_ftth' : 'outstanding_lc';
      // Note: Database values were imported with 100× inflation (10^9 instead of 10^7)
      const CORRECTION_FACTOR = 100;
      
      let circleFilter = sql`1=1`;
      if (input.circle) {
        circleFilter = sql`circle = ${input.circle}`;
      }
      
      const result = await db.execute(sql`
        SELECT 
          id,
          name,
          pers_no,
          circle,
          designation,
          (CAST(${sql.raw(column)} AS NUMERIC) / ${CORRECTION_FACTOR})::text as outstanding_amount
        FROM employees
        WHERE ${sql.raw(column)} IS NOT NULL 
          AND CAST(${sql.raw(column)} AS NUMERIC) > 0
          AND ${circleFilter}
        ORDER BY CAST(${sql.raw(column)} AS NUMERIC) DESC
        LIMIT ${input.limit}
        OFFSET ${input.offset}
      `);
      
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM employees
        WHERE ${sql.raw(column)} IS NOT NULL 
          AND CAST(${sql.raw(column)} AS NUMERIC) > 0
          AND ${circleFilter}
      `);
      
      const total = parseInt((countResult as any)[0]?.total || '0');
      
      return {
        employees: result as unknown as Array<{
          id: string;
          name: string;
          pers_no: string;
          circle: string | null;
          designation: string | null;
          outstanding_amount: string;
        }>,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),
});
