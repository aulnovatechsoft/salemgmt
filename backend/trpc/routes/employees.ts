import { z } from "zod";
import { eq, and, ilike, desc, isNotNull, inArray } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, employees, employeeMaster, auditLogs } from "@/backend/db";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

const passwordResetRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESETS_PER_HOUR = 10;

function checkRateLimit(managerId: string): { allowed: boolean; remainingResets: number } {
  const now = Date.now();
  const record = passwordResetRateLimit.get(managerId);
  
  if (!record || now > record.resetAt) {
    passwordResetRateLimit.set(managerId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remainingResets: MAX_RESETS_PER_HOUR - 1 };
  }
  
  if (record.count >= MAX_RESETS_PER_HOUR) {
    const minutesRemaining = Math.ceil((record.resetAt - now) / 60000);
    return { allowed: false, remainingResets: 0 };
  }
  
  record.count++;
  return { allowed: true, remainingResets: MAX_RESETS_PER_HOUR - record.count };
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  // Check if password is already hashed (starts with $2a$ or $2b$)
  if (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$')) {
    return bcrypt.compare(password, hashedPassword);
  }
  // Legacy plain text comparison for old passwords
  return password === hashedPassword;
}

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
      
      // Apply correction factor for outstanding amounts
      // Database values were imported with 100 inflation (10^9 instead of 10^7)
      const CORRECTION_FACTOR = 100;
      return results.map(employee => ({
        ...employee,
        outstandingFtth: employee.outstandingFtth 
          ? (parseFloat(employee.outstandingFtth) / CORRECTION_FACTOR).toString() 
          : employee.outstandingFtth,
        outstandingLc: employee.outstandingLc 
          ? (parseFloat(employee.outstandingLc) / CORRECTION_FACTOR).toString() 
          : employee.outstandingLc,
      }));
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by id:", input.id);
      const result = await db.select().from(employees).where(eq(employees.id, input.id));
      const employee = result[0] || null;
      
      // Apply correction factor for outstanding amounts
      // Database values were imported with 100 inflation (10^9 instead of 10^7)
      if (employee) {
        const CORRECTION_FACTOR = 100;
        if (employee.outstandingFtth) {
          employee.outstandingFtth = (parseFloat(employee.outstandingFtth) / CORRECTION_FACTOR).toString();
        }
        if (employee.outstandingLc) {
          employee.outstandingLc = (parseFloat(employee.outstandingLc) / CORRECTION_FACTOR).toString();
        }
      }
      
      return employee;
    }),

  getByEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by email:", input.email);
      const result = await db.select().from(employees).where(eq(employees.email, input.email));
      const employee = result[0] || null;
      
      // Apply correction factor for outstanding amounts
      if (employee) {
        const CORRECTION_FACTOR = 100;
        if (employee.outstandingFtth) {
          employee.outstandingFtth = (parseFloat(employee.outstandingFtth) / CORRECTION_FACTOR).toString();
        }
        if (employee.outstandingLc) {
          employee.outstandingLc = (parseFloat(employee.outstandingLc) / CORRECTION_FACTOR).toString();
        }
      }
      
      return employee;
    }),

  getByPhone: publicProcedure
    .input(z.object({ phone: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching employee by phone:", input.phone);
      const result = await db.select().from(employees).where(eq(employees.phone, input.phone));
      const employee = result[0] || null;
      
      // Apply correction factor for outstanding amounts
      if (employee) {
        const CORRECTION_FACTOR = 100;
        if (employee.outstandingFtth) {
          employee.outstandingFtth = (parseFloat(employee.outstandingFtth) / CORRECTION_FACTOR).toString();
        }
        if (employee.outstandingLc) {
          employee.outstandingLc = (parseFloat(employee.outstandingLc) / CORRECTION_FACTOR).toString();
        }
      }
      
      return employee;
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
      reportingPersNo: z.string().uuid().optional(),
      persNo: z.string().optional(),
      designation: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating employee:", input.name);
      
      // Check for duplicate Pers Number
      if (input.persNo) {
        const existing = await db.select({ id: employees.id })
          .from(employees)
          .where(eq(employees.persNo, input.persNo));
        
        if (existing.length > 0) {
          throw new Error("An account with this Pers Number already exists. Please login instead.");
        }
      }
      
      // Check for duplicate email
      const existingEmail = await db.select({ id: employees.id })
        .from(employees)
        .where(eq(employees.email, input.email));
      
      if (existingEmail.length > 0) {
        throw new Error("An account with this email already exists. Please login instead.");
      }
      
      const hashedPassword = input.password ? await hashPassword(input.password) : null;
      
      const result = await db.insert(employees).values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        password: hashedPassword,
        role: input.role,
        circle: input.circle,
        zone: input.zone,
        reportingPersNo: input.reportingPersNo,
        persNo: input.persNo,
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
      reportingPersNo: z.string().uuid().optional().nullable(),
      persNo: z.string().optional(),
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
      username: z.string().min(1),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        console.log("=== LOGIN REQUEST RECEIVED ===");
        console.log("Raw username input:", input.username);
        console.log("Password provided:", input.password ? "yes (" + input.password.length + " chars)" : "no");
        
        const trimmedUsername = input.username.trim();
        const isEmail = trimmedUsername.includes('@');
        
        let employee = null;
        
        if (isEmail) {
          const normalizedEmail = trimmedUsername.toLowerCase();
          console.log("Login type: Email -", normalizedEmail);
          
          const result = await db.select().from(employees)
            .where(ilike(employees.email, normalizedEmail));
          
          if (result.length > 0) {
            employee = result[0];
          }
        } else {
          console.log("Login type: Pers Number -", trimmedUsername);
          
          const result = await db.select().from(employees)
            .where(eq(employees.persNo, trimmedUsername));
          
          if (result.length > 0) {
            employee = result[0];
          }
        }
        
        if (!employee) {
          console.log("Employee not found with:", trimmedUsername);
          throw new Error(isEmail ? "Email not found. Please register first." : "Employee Pers Number not found. Please contact administrator.");
        }
        
        console.log("Found employee ID:", employee.id, "name:", employee.name, "isActive:", employee.isActive);
        
        if (employee.isActive === false) {
          console.log("Employee account is deactivated:", employee.id);
          throw new Error("Account is deactivated. Please contact administrator.");
        }
        
        const storedPassword = employee.password || '';
        const inputPassword = input.password || '';
        console.log("Password check - stored length:", storedPassword.length, "input length:", inputPassword.length);
        
        const isPasswordValid = await verifyPassword(inputPassword, storedPassword);
        if (!isPasswordValid) {
          console.log("Password mismatch for employee:", employee.id);
          throw new Error("Invalid password");
        }
        
        console.log("Login successful for employee:", employee.id, "role:", employee.role, "outstanding_ftth:", employee.outstandingFtth, "outstanding_lc:", employee.outstandingLc);
        
        const needsChange = (employee as any).needsPasswordChange ?? false;
        
        return {
          ...employee,
          needsPasswordChange: needsChange,
        };
      } catch (error: any) {
        console.error("=== LOGIN ERROR ===");
        console.error("Error message:", error?.message);
        console.error("Error stack:", error?.stack);
        throw error;
      }
    }),

  changePassword: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
      currentPassword: z.string(),
      newPassword: z.string().min(6, "Password must be at least 6 characters"),
    }))
    .mutation(async ({ input }) => {
      console.log("=== CHANGE PASSWORD REQUEST ===");
      
      const result = await db.select().from(employees)
        .where(eq(employees.id, input.employeeId));
      
      if (result.length === 0) {
        throw new Error("Employee not found");
      }
      
      const employee = result[0];
      
      const isCurrentPasswordValid = await verifyPassword(input.currentPassword, employee.password || '');
      if (!isCurrentPasswordValid) {
        throw new Error("Current password is incorrect");
      }
      
      const hashedNewPassword = await hashPassword(input.newPassword);
      await db.update(employees)
        .set({
          password: hashedNewPassword,
          needsPasswordChange: false,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, input.employeeId));
      
      console.log("Password changed for employee:", input.employeeId);
      return { success: true };
    }),

  resetPasswordByManager: publicProcedure
    .input(z.object({
      managerId: z.string().uuid(),
      employeeId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("=== MANAGER PASSWORD RESET REQUEST ===");
      console.log("Manager ID:", input.managerId);
      console.log("Employee ID:", input.employeeId);
      
      const rateCheck = checkRateLimit(input.managerId);
      if (!rateCheck.allowed) {
        console.log("Rate limit exceeded for manager:", input.managerId);
        throw new Error("Rate limit exceeded. You can reset a maximum of 10 passwords per hour. Please try again later.");
      }
      
      const [managerResult, employeeResult] = await Promise.all([
        db.select().from(employees).where(eq(employees.id, input.managerId)),
        db.select().from(employees).where(eq(employees.id, input.employeeId)),
      ]);
      
      if (managerResult.length === 0) {
        throw new Error("Manager not found");
      }
      
      if (employeeResult.length === 0) {
        throw new Error("Employee not found");
      }
      
      const manager = managerResult[0];
      const employee = employeeResult[0];
      
      const roleHierarchy: Record<string, number> = {
        'GM': 6,
        'CGM': 5,
        'DGM': 4,
        'AGM': 3,
        'SD_JTO': 2,
        'SALES_STAFF': 1,
      };
      
      const managerLevel = roleHierarchy[manager.role] || 0;
      const employeeLevel = roleHierarchy[employee.role] || 0;
      
      if (managerLevel <= employeeLevel) {
        await db.insert(auditLogs).values({
          action: 'PASSWORD_RESET_DENIED',
          entityType: 'EMPLOYEE',
          entityId: input.employeeId,
          performedBy: input.managerId,
          details: { reason: 'Insufficient role level', managerRole: manager.role, employeeRole: employee.role },
        });
        throw new Error("You can only reset passwords for employees below your role level");
      }
      
      if (manager.circle !== employee.circle && manager.role !== 'GM' && manager.role !== 'CGM') {
        await db.insert(auditLogs).values({
          action: 'PASSWORD_RESET_DENIED',
          entityType: 'EMPLOYEE',
          entityId: input.employeeId,
          performedBy: input.managerId,
          details: { reason: 'Circle mismatch', managerCircle: manager.circle, employeeCircle: employee.circle },
        });
        throw new Error("You can only reset passwords for employees in your circle");
      }
      
      if (!employee.persNo) {
        throw new Error("Employee does not have a Pers Number. Cannot generate default password.");
      }
      
      const last4 = employee.persNo.slice(-4).padStart(4, '0');
      const defaultPassword = `BSNL@${last4}`;
      const hashedPassword = await hashPassword(defaultPassword);
      
      await db.update(employees)
        .set({
          password: hashedPassword,
          needsPasswordChange: true,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, input.employeeId));
      
      await db.insert(auditLogs).values({
        action: 'PASSWORD_RESET_BY_MANAGER',
        entityType: 'EMPLOYEE',
        entityId: input.employeeId,
        performedBy: input.managerId,
        details: { 
          employeeName: employee.name,
          employeePersNo: employee.persNo,
          managerName: manager.name,
          managerRole: manager.role,
          resetMethod: 'default_password',
        },
      });
      
      console.log("Password reset successfully for employee:", input.employeeId);
      console.log("Audit log created for password reset");
      console.log("Remaining resets this hour:", rateCheck.remainingResets);
      
      return { 
        success: true, 
        message: `Password reset to default. Employee must change password on next login.`,
        passwordHint: `Default password: BSNL@ + last 4 digits of Pers No (${last4})`,
        remainingResets: rateCheck.remainingResets,
      };
    }),

  getSubordinates: publicProcedure
    .input(z.object({
      managerId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching subordinates for manager:", input.managerId);
      
      const managerResult = await db.select().from(employees).where(eq(employees.id, input.managerId));
      
      if (managerResult.length === 0) {
        throw new Error("Manager not found");
      }
      
      const manager = managerResult[0];
      
      const roleHierarchy: Record<string, number> = {
        'GM': 6,
        'CGM': 5,
        'DGM': 4,
        'AGM': 3,
        'SD_JTO': 2,
        'SALES_STAFF': 1,
      };
      
      const managerLevel = roleHierarchy[manager.role] || 0;
      
      const subordinateRoles = Object.entries(roleHierarchy)
        .filter(([_, level]) => level < managerLevel)
        .map(([role]) => role);
      
      if (subordinateRoles.length === 0) {
        return [];
      }
      
      let query = db.select({
        id: employees.id,
        name: employees.name,
        email: employees.email,
        phone: employees.phone,
        role: employees.role,
        circle: employees.circle,
        zone: employees.zone,
        persNo: employees.persNo,
        designation: employees.designation,
        isActive: employees.isActive,
        needsPasswordChange: employees.needsPasswordChange,
      }).from(employees).where(
        and(
          eq(employees.isActive, true),
          inArray(employees.role, subordinateRoles as any)
        )
      );
      
      if (manager.role !== 'GM' && manager.role !== 'CGM') {
        const results = await db.select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          phone: employees.phone,
          role: employees.role,
          circle: employees.circle,
          zone: employees.zone,
          persNo: employees.persNo,
          designation: employees.designation,
          isActive: employees.isActive,
          needsPasswordChange: employees.needsPasswordChange,
        }).from(employees).where(
          and(
            eq(employees.isActive, true),
            eq(employees.circle, manager.circle),
            inArray(employees.role, subordinateRoles as any)
          )
        );
        return results;
      }
      
      const results = await query;
      return results;
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
        .where(eq(employeeMaster.persNo, input.staffId));
      
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
          persNo: input.staffId,
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
          ilike(employeeMaster.persNo, `%${input.query}%`),
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
            persNo: master?.persNo || emp[0].persNo,
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
          persNo: masterRecord[0]?.persNo || result[0].persNo,
        };
      }
      return null;
    }),

  getMasterByPersNo: publicProcedure
    .input(z.object({ persNo: z.string() }))
    .query(async ({ input }) => {
      const normalizedPersNo = input.persNo.trim().replace(/^0+/, '') || input.persNo.trim();
      console.log('getMasterByPersNo called with:', input.persNo, '-> normalized:', normalizedPersNo);
      
      // First try to find in employees table (registered users with updated profiles)
      const employeeRecord = await db.select().from(employees)
        .where(eq(employees.persNo, normalizedPersNo));
      
      if (employeeRecord[0]) {
        console.log('Found in employees table:', employeeRecord[0].name);
        return {
          id: employeeRecord[0].id,
          persNo: employeeRecord[0].persNo || normalizedPersNo,
          name: employeeRecord[0].name,
          circle: employeeRecord[0].circle,
          zone: employeeRecord[0].zone,
          designation: employeeRecord[0].designation,
          division: employeeRecord[0].division,
          empGroup: null,
          reportingPersNo: employeeRecord[0].managerId,
          reportingOfficerName: null,
          reportingOfficerDesignation: null,
          buildingName: null,
          officeName: null,
          shiftGroup: null,
          distanceLimit: null,
          sortOrder: null,
          employeeId: null,
          isLinked: true,
          linkedEmployeeId: employeeRecord[0].id,
          linkedAt: null,
          createdAt: employeeRecord[0].createdAt,
          updatedAt: employeeRecord[0].updatedAt,
        };
      }
      
      // Fallback to employee_master table (static import data)
      const masterRecord = await db.select().from(employeeMaster)
        .where(eq(employeeMaster.persNo, normalizedPersNo));
      
      console.log('Employee master lookup result:', masterRecord[0]?.name || 'NOT FOUND');
      return masterRecord[0] || null;
    }),
});
