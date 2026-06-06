import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const PRODUCTION_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://salesmgmt.ddns.net';

const getBaseUrl = () => {
  // For native mobile apps (iOS/Android), ALWAYS use production API
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    console.log('[TRPC] Mobile platform detected, using production URL:', PRODUCTION_API_URL);
    return PRODUCTION_API_URL;
  }

  // For web, use window.location.origin only when NOT on localhost (i.e. deployed on the real server)
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    if (!isLocalhost) {
      console.log('[TRPC] Web platform (deployed), using window.location.origin:', origin);
      return origin;
    }
  }

  // Local dev or fallback — always hit the production API
  console.log('[TRPC] Local/fallback, using production URL:', PRODUCTION_API_URL);
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
