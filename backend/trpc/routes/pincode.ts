import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { TRPCError } from "@trpc/server";

// Server-side proxy for India PIN code lookups.
//
// Why this route exists:
//   The frontend used to call `https://api.postalpincode.in/pincode/<pin>`
//   directly from the browser. As of 2026-05-21 that host is serving an
//   EXPIRED TLS certificate that is ALSO issued for the wrong CN
//   (`biswajeetsamal.com`), so every modern browser rejects the
//   connection and the fetch() in create-event.tsx throws — the user
//   sees "Failed to fetch location". The upstream JSON payload itself
//   is still valid and unchanged.
//
//   We can't fix the upstream cert, so we proxy the call server-side
//   where we control TLS behaviour. Bun's fetch supports a `tls`
//   option that lets us skip verification for THIS specific request
//   only (we never disable verification globally).
//
//   If the upstream renews its cert we can keep this route — it also
//   shields the frontend from any future API change (host swap, schema
//   change, rate limits, etc.) by giving us one place to fix.

const PincodeLookupInput = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
});

interface PostOffice {
  Name: string;
  District: string;
  State: string;
  Division: string;
  Region: string;
  Block: string;
  Country: string;
  Pincode: string;
  BranchType: string;
  DeliveryStatus: string;
}

interface UpstreamResponse {
  Status: string;
  Message: string;
  PostOffice: PostOffice[] | null;
}

export const pincodeRouter = createTRPCRouter({
  lookup: publicProcedure
    .input(PincodeLookupInput)
    .query(async ({ input }) => {
      const url = `https://api.postalpincode.in/pincode/${input.pin}`;
      let res: Response;
      try {
        res = await fetch(url, {
          // Bun-specific: skip TLS verification for this call only.
          // Upstream cert is expired AND issued for the wrong CN.
          // Safe because (a) we don't send credentials, (b) the payload
          // is public reference data, (c) scope is one request.
          // @ts-ignore - Bun fetch extension, not in standard lib.dom types
          tls: { rejectUnauthorized: false },
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
      } catch (err) {
        console.error("[pincode.lookup] upstream network error", err);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "PIN code service is temporarily unreachable. Please enter the location manually.",
        });
      }

      if (!res.ok) {
        console.error("[pincode.lookup] upstream HTTP", res.status);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `PIN code service returned ${res.status}. Please enter the location manually.`,
        });
      }

      let body: UpstreamResponse[];
      try {
        body = (await res.json()) as UpstreamResponse[];
      } catch (err) {
        console.error("[pincode.lookup] upstream JSON parse error", err);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "PIN code service returned an invalid response. Please enter the location manually.",
        });
      }

      const first = body?.[0];
      if (!first || first.Status !== "Success" || !first.PostOffice || first.PostOffice.length === 0) {
        return { found: false as const, postOffices: [] };
      }

      // Return the full PostOffice array; the frontend already picks [0]
      // and reads Name / District / State / Division. We preserve the
      // upstream key casing so the frontend change stays minimal.
      return {
        found: true as const,
        postOffices: first.PostOffice.map(p => ({
          Name: p.Name,
          District: p.District,
          State: p.State,
          Division: p.Division,
          Block: p.Block,
        })),
      };
    }),
});
