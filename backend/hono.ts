import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ status: "ok", message: "BSNL Event & Sales API v1.0.5" });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", version: "1.0.5", timestamp: new Date().toISOString() });
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      console.error(`tRPC error on path '${path}':`, error.message);
    },
  }),
);

export default app;
