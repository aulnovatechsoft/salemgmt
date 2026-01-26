import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { Platform } from "react-native";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const API_BASE_URL = 'https://0f579411-6452-4f34-a09b-bceba9c28ac4-00-ai5gp1yoo93b.kirk.replit.dev';

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
