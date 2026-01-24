import { z } from "zod";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, employees, employeeMaster, auditLogs, events } from "@/backend/db";

export const adminRouter = createTRPCRouter({
  importEmployeeMaster: publicProcedure
    .input(z.object({
      data: z.array(z.object({
        purseId: z.string().min(1),
        name: z.string().min(1),
        circle: z.string().optional(),
        zone: z.string().optional(),
        designation: z.string().optional(),
        empGroup: z.string().optional(),
        reportingPurseId: z.string().optional(),
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
      
      let imported = 0;
      let updated = 0;
      let errors: string[] = [];
      
      for (const record of input.data) {
        try {
          const existing = await db.select().from(employeeMaster)
            .where(eq(employeeMaster.purseId, record.purseId));
          
          if (existing[0]) {
            await db.update(employeeMaster)
              .set({
                name: record.name,
                circle: record.circle || null,
                zone: record.zone || null,
                designation: record.designation || null,
                empGroup: record.empGroup || null,
                reportingPurseId: record.reportingPurseId || null,
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
              .where(eq(employeeMaster.purseId, record.purseId));
            updated++;
          } else {
            await db.insert(employeeMaster).values({
              purseId: record.purseId,
              name: record.name,
              circle: record.circle || null,
              zone: record.zone || null,
              designation: record.designation || null,
              empGroup: record.empGroup || null,
              reportingPurseId: record.reportingPurseId || null,
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
          errors.push(`Row ${record.purseId}: ${error.message}`);
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
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching employee master list");
      
      let query = db.select().from(employeeMaster);
      
      if (input?.linked === true) {
        query = query.where(eq(employeeMaster.isLinked, true)) as any;
      } else if (input?.linked === false) {
        query = query.where(eq(employeeMaster.isLinked, false)) as any;
      }
      
      const results = await query
        .orderBy(desc(employeeMaster.createdAt))
        .limit(input?.limit || 50)
        .offset(input?.offset || 0);
      
      const countResult = await db.select({ count: sql<number>`count(*)` }).from(employeeMaster);
      const total = Number(countResult[0]?.count || 0);
      
      return { data: results, total };
    }),

  getEmployeeMasterByPurseId: publicProcedure
    .input(z.object({ purseId: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee master by purse ID:", input.purseId);
      
      const result = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.purseId, input.purseId));
      
      if (!result[0]) return null;
      
      let manager = null;
      if (result[0].reportingPurseId) {
        const managerResult = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.purseId, result[0].reportingPurseId));
        manager = managerResult[0] || null;
      }
      
      return { ...result[0], manager };
    }),

  linkEmployeeProfile: publicProcedure
    .input(z.object({
      purseId: z.string(),
      employeeId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Linking employee profile:", input.purseId, "to", input.employeeId);
      
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.purseId, input.purseId));
      
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
        .where(eq(employeeMaster.purseId, input.purseId));
      
      let reportingOfficerId = null;
      if (masterRecord[0].reportingPurseId) {
        const managerMaster = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.purseId, masterRecord[0].reportingPurseId));
        
        if (managerMaster[0]?.linkedEmployeeId) {
          reportingOfficerId = managerMaster[0].linkedEmployeeId;
        }
      }
      
      await db.update(employees)
        .set({
          employeeNo: input.purseId,
          reportingOfficerId: reportingOfficerId,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, input.employeeId));
      
      const subordinateMasters = await db.select().from(employeeMaster)
        .where(and(
          eq(employeeMaster.reportingPurseId, input.purseId),
          eq(employeeMaster.isLinked, true)
        ));
      
      for (const sub of subordinateMasters) {
        if (sub.linkedEmployeeId) {
          await db.update(employees)
            .set({
              reportingOfficerId: input.employeeId,
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
        details: { purseId: input.purseId, subordinatesUpdated: subordinateMasters.length },
      });
      
      return { success: true, masterData: masterRecord[0] };
    }),

  getMyHierarchy: publicProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching hierarchy for employee:", input.employeeId);
      
      const employee = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (!employee[0]?.employeeNo) {
        return { manager: null, subordinates: [], isLinked: false };
      }
      
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.purseId, employee[0].employeeNo));
      
      if (!masterRecord[0]) {
        return { manager: null, subordinates: [], isLinked: false };
      }
      
      let manager = null;
      if (masterRecord[0].reportingPurseId) {
        const managerMaster = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.purseId, masterRecord[0].reportingPurseId));
        
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
        .where(eq(employeeMaster.reportingPurseId, employee[0].employeeNo));
      
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
      purseId: z.string(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Deleting employee master:", input.purseId);
      
      const record = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.purseId, input.purseId));
      
      if (record[0]?.isLinked) {
        throw new Error("Cannot delete linked employee. Unlink first.");
      }
      
      await db.delete(employeeMaster)
        .where(eq(employeeMaster.purseId, input.purseId));
      
      await db.insert(auditLogs).values({
        action: 'DELETE_EMPLOYEE_MASTER',
        entityType: 'EMPLOYEE',
        entityId: input.deletedBy,
        performedBy: input.deletedBy,
        details: { purseId: input.purseId },
      });
      
      return { success: true };
    }),

  clearEmployeeMaster: publicProcedure
    .input(z.object({ clearedBy: z.string().uuid() }))
    .mutation(async ({ input }) => {
      console.log("Clearing all unlinked employee master records");
      
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
    .query(async () => {
      const total = await db.select({ count: sql<number>`count(*)` }).from(employeeMaster);
      const linked = await db.select({ count: sql<number>`count(*)` })
        .from(employeeMaster)
        .where(eq(employeeMaster.isLinked, true));
      
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
});
