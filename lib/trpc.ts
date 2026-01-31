import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { Platform } from "react-native";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const API_BASE_URL = 'http://117.251.72.195';

const getBaseUrl = () => {
  // For native mobile apps (iOS/Android), always use the hardcoded API URL
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return API_BASE_URL;
  }
  
  // For web, use window.location.origin
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  return API_BASE_URL;
};

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
