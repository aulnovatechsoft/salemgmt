import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const headerEmployeeId = opts.req.headers.get('x-employee-id') || null;
  const employeeId = headerEmployeeId && UUID_RE.test(headerEmployeeId) ? headerEmployeeId : null;
  return {
    req: opts.req,
    employeeId,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.employeeId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please log in again.',
    });
  }
  return next({
    ctx: {
      ...ctx,
      employeeId: ctx.employeeId,
    },
  });
});
