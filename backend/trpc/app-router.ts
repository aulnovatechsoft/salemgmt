import { createTRPCRouter } from "./create-context";
import { employeesRouter } from "./routes/employees";
import { eventsRouter } from "./routes/events";
import { salesRouter } from "./routes/sales";
import { issuesRouter } from "./routes/issues";
import { resourcesRouter } from "./routes/resources";
import { auditRouter } from "./routes/audit";
import { otpRouter } from "./routes/otp";
import { rolesRouter } from "./routes/roles";
import { circlesRouter } from "./routes/circles";
import { divisionsRouter } from "./routes/divisions";
import { adminRouter } from "./routes/admin";
import { notificationsRouter } from "./routes/notifications";

export const appRouter = createTRPCRouter({
  employees: employeesRouter,
  events: eventsRouter,
  sales: salesRouter,
  issues: issuesRouter,
  resources: resourcesRouter,
  audit: auditRouter,
  otp: otpRouter,
  roles: rolesRouter,
  circles: circlesRouter,
  divisions: divisionsRouter,
  admin: adminRouter,
  notifications: notificationsRouter,
});

export type AppRouter = typeof appRouter;
