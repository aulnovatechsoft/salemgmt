import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const getBaseUrl = () => {
  if (Platform.OS !== 'web') {
    const url = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
    if (url) {
      return url;
    }
    return 'http://localhost:5000';
  }

  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  return 'http://localhost:5000';
};

let currentEmployeeId: string | null = null;

export const setCurrentEmployeeId = (id: string | null) => {
  currentEmployeeId = id;
};

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
      headers: () => {
        const headers: Record<string, string> = {};
        if (currentEmployeeId) {
          headers['x-employee-id'] = currentEmployeeId;
        }
        return headers;
      },
    }),
  ],
});
