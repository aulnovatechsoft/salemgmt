import { z } from "zod";
import { eq, and, ilike, desc, isNotNull } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, employees, employeeMaster } from "@/backend/db";

export const employeesRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
      role: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all employees", input);
      let query = db.select().from(employees);
      
      const results = await query.orderBy(desc(employees.createdAt));
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by id:", input.id);
      const result = await db.select().from(employees).where(eq(employees.id, input.id));
      return result[0] || null;
    }),

  getByEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by email:", input.email);
      const result = await db.select().from(employees).where(eq(employees.email, input.email));
      return result[0] || null;
    }),

  getByPhone: publicProcedure
    .input(z.object({ phone: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by phone:", input.phone);
      const result = await db.select().from(employees).where(eq(employees.phone, input.phone));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(10),
      password: z.string().optional(),
      role: z.enum(['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO', 'SALES_STAFF']),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      zone: z.string().min(1),
      reportingOfficerId: z.string().uuid().optional(),
      employeeNo: z.string().optional(),
      designation: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating employee:", input.name);
      const result = await db.insert(employees).values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        password: input.password,
        role: input.role,
        circle: input.circle,
        zone: input.zone,
        reportingOfficerId: input.reportingOfficerId,
        employeeNo: input.employeeNo,
        designation: input.designation,
      }).returning();
      
      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().min(10).optional(),
      password: z.string().optional(),
      role: z.enum(['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO', 'SALES_STAFF']).optional(),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']).optional(),
      zone: z.string().min(1).optional(),
      reportingOfficerId: z.string().uuid().optional().nullable(),
      employeeNo: z.string().optional(),
      designation: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating employee:", input.id);
      const { id, ...updateData } = input;
      const result = await db.update(employees)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(employees.id, id))
        .returning();
      
      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      console.log("Deleting employee:", input.id);
      await db.update(employees)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(employees.id, input.id));
      
      return { success: true };
    }),

  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        console.log("=== LOGIN REQUEST RECEIVED ===");
        console.log("Raw email input:", input.email);
        console.log("Password provided:", input.password ? "yes (" + input.password.length + " chars)" : "no");
        
        const normalizedEmail = input.email.trim().toLowerCase();
        console.log("Normalized email:", normalizedEmail);
        
        // Use ilike for case-insensitive exact match
        console.log("Executing database query...");
        const result = await db.select().from(employees)
          .where(ilike(employees.email, normalizedEmail));
        
        console.log("Login query result count:", result.length);
        
        if (result.length === 0) {
          // Log all emails for debugging
          const allEmployees = await db.select({ email: employees.email, isActive: employees.isActive }).from(employees);
          console.log("All registered emails in database:", JSON.stringify(allEmployees.map(e => ({ email: e.email, isActive: e.isActive }))));
          throw new Error("Employee not found with email: " + normalizedEmail);
        }
        
        const employee = result[0];
        console.log("Found employee ID:", employee.id, "name:", employee.name, "isActive:", employee.isActive);
        
        // Check if employee is active (treat null as active)
        if (employee.isActive === false) {
          console.log("Employee account is deactivated:", employee.id);
          throw new Error("Account is deactivated. Please contact administrator.");
        }
        
        // Verify password
        const storedPassword = employee.password || '';
        const inputPassword = input.password || '';
        console.log("Password check - stored length:", storedPassword.length, "input length:", inputPassword.length);
        
        if (storedPassword !== inputPassword) {
          console.log("Password mismatch for employee:", employee.id);
          throw new Error("Invalid password");
        }
        
        console.log("Login successful for employee:", employee.id);
        return employee;
      } catch (error: any) {
        console.error("=== LOGIN ERROR ===");
        console.error("Error message:", error?.message);
        console.error("Error stack:", error?.stack);
        throw error;
      }
    }),

  getByCircle: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching employees by circle:", input.circle);
      const result = await db.select().from(employees)
        .where(and(
          eq(employees.circle, input.circle),
          eq(employees.isActive, true)
        ));
      return result;
    }),

  getByRole: publicProcedure
    .input(z.object({ 
      role: z.enum(['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO', 'SALES_STAFF'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching employees by role:", input.role);
      const result = await db.select().from(employees)
        .where(and(
          eq(employees.role, input.role),
          eq(employees.isActive, true)
        ));
      return result;
    }),

  getByStaffId: publicProcedure
    .input(z.object({ staffId: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by Purse ID:", input.staffId);
      
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.purseId, input.staffId));
      
      if (!masterRecord[0]) {
        console.log("No master record found for Purse ID:", input.staffId);
        return null;
      }
      
      const linkedEmployeeId = masterRecord[0].linkedEmployeeId;
      if (!linkedEmployeeId) {
        console.log("Master record found but not linked to any employee account");
        return null;
      }
      
      const result = await db.select().from(employees)
        .where(and(
          eq(employees.id, linkedEmployeeId),
          eq(employees.isActive, true)
        ));
      
      if (result[0]) {
        return {
          ...result[0],
          employeeNo: input.staffId,
        };
      }
      return null;
    }),

  searchByStaffId: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      console.log("Searching employees by Purse ID:", input.query);
      if (!input.query || input.query.length < 1) return [];
      
      const masterRecords = await db.select().from(employeeMaster)
        .where(and(
          ilike(employeeMaster.purseId, `%${input.query}%`),
          isNotNull(employeeMaster.linkedEmployeeId)
        ));
      
      if (masterRecords.length === 0) return [];
      
      const employeeIds = masterRecords.map(m => m.linkedEmployeeId).filter(Boolean) as string[];
      const results = [];
      
      for (const empId of employeeIds) {
        const emp = await db.select().from(employees)
          .where(and(
            eq(employees.id, empId),
            eq(employees.isActive, true)
          ));
        if (emp[0]) {
          const master = masterRecords.find(m => m.linkedEmployeeId === empId);
          results.push({
            ...emp[0],
            employeeNo: master?.purseId || emp[0].employeeNo,
          });
        }
      }
      
      return results;
    }),

  getByMobile: publicProcedure
    .input(z.object({ mobile: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by mobile:", input.mobile);
      
      const result = await db.select().from(employees)
        .where(and(
          eq(employees.phone, input.mobile),
          eq(employees.isActive, true)
        ));
      
      if (result[0]) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.linkedEmployeeId, result[0].id));
        
        return {
          ...result[0],
          employeeNo: masterRecord[0]?.purseId || result[0].employeeNo,
        };
      }
      return null;
    }),
});
