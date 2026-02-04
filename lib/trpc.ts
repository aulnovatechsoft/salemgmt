import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const PRODUCTION_API_URL = 'http://117.251.72.195';

const getBaseUrl = () => {
  // For native mobile apps (iOS/Android), ALWAYS use production API
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    console.log('[TRPC] Mobile platform detected, using production URL:', PRODUCTION_API_URL);
    return PRODUCTION_API_URL;
  }
  
  // For web, use window.location.origin (same server)
  if (typeof window !== 'undefined' && window.location) {
    console.log('[TRPC] Web platform, using window.location.origin:', window.location.origin);
    return window.location.origin;
  }
  
  // Fallback
  console.log('[TRPC] Fallback to production URL:', PRODUCTION_API_URL);
  return PRODUCTION_API_URL;
};

let cachedEmployeeId: string | null = null;

export const setEmployeeId = (id: string | null) => {
  cachedEmployeeId = id;
};

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
      headers: async () => {
        if (cachedEmployeeId) {
          return { 'x-employee-id': cachedEmployeeId };
        }
        try {
          const storedEmployee = await AsyncStorage.getItem('employee');
          if (storedEmployee) {
            const employee = JSON.parse(storedEmployee);
            if (employee?.id) {
              cachedEmployeeId = employee.id;
              return { 'x-employee-id': employee.id };
            }
          }
        } catch (e) {
          console.error('[TRPC] Error getting employee ID for headers:', e);
        }
        return {};
      },
    }),
  ],
});
