import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const authHeader = opts.req.headers.get('x-employee-id');
  
  return {
    req: opts.req,
    employeeId: authHeader || null,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.employeeId) {
    throw new TRPCError({ 
      code: 'UNAUTHORIZED',
      message: 'Employee ID is required for this operation'
    });
  }
  
  return next({
    ctx: {
      ...ctx,
      employeeId: ctx.employeeId,
    },
  });
});
