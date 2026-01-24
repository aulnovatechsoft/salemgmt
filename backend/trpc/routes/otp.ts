import { z } from "zod";
import { eq, and, gt } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, otpVerifications, employees } from "@/backend/db";

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const otpRouter = createTRPCRouter({
  sendOTP: publicProcedure
    .input(z.object({
      identifier: z.string(),
      type: z.enum(['email', 'mobile']),
    }))
    .mutation(async ({ input }) => {
      console.log("Sending OTP to:", input.identifier);
      
      let employee;
      if (input.type === 'email') {
        const result = await db.select().from(employees).where(eq(employees.email, input.identifier));
        employee = result[0];
      } else {
        const result = await db.select().from(employees).where(eq(employees.phone, input.identifier));
        employee = result[0];
      }

      if (!employee) {
        throw new Error("Employee not found with this " + input.type);
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await db.insert(otpVerifications).values({
        identifier: input.identifier,
        type: input.type,
        otp: otp,
        expiresAt: expiresAt,
      });

      console.log(`OTP for ${input.identifier}: ${otp}`);

      return { 
        success: true, 
        message: `OTP sent to your ${input.type}`,
        otp: otp,
      };
    }),

  verifyOTP: publicProcedure
    .input(z.object({
      identifier: z.string(),
      type: z.enum(['email', 'mobile']),
      otp: z.string().length(6),
    }))
    .mutation(async ({ input }) => {
      console.log("Verifying OTP for:", input.identifier);
      
      const now = new Date();
      const verification = await db.select().from(otpVerifications)
        .where(and(
          eq(otpVerifications.identifier, input.identifier),
          eq(otpVerifications.type, input.type),
          eq(otpVerifications.otp, input.otp),
          gt(otpVerifications.expiresAt, now)
        ))
        .limit(1);

      if (!verification[0]) {
        throw new Error("Invalid or expired OTP");
      }

      await db.delete(otpVerifications)
        .where(eq(otpVerifications.identifier, input.identifier));

      let employee;
      if (input.type === 'email') {
        const result = await db.select().from(employees).where(eq(employees.email, input.identifier));
        employee = result[0];
      } else {
        const result = await db.select().from(employees).where(eq(employees.phone, input.identifier));
        employee = result[0];
      }

      if (!employee) {
        throw new Error("Employee not found");
      }

      return { 
        success: true, 
        employee: employee,
      };
    }),

  resendOTP: publicProcedure
    .input(z.object({
      identifier: z.string(),
      type: z.enum(['email', 'mobile']),
    }))
    .mutation(async ({ input }) => {
      console.log("Resending OTP to:", input.identifier);
      
      await db.delete(otpVerifications)
        .where(eq(otpVerifications.identifier, input.identifier));

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await db.insert(otpVerifications).values({
        identifier: input.identifier,
        type: input.type,
        otp: otp,
        expiresAt: expiresAt,
      });

      console.log(`New OTP for ${input.identifier}: ${otp}`);

      return { 
        success: true, 
        message: `New OTP sent to your ${input.type}`,
        otp: otp,
      };
    }),
});
