import postgres from "postgres";
import type { Sql } from "postgres";

const REQUIRED_NOTIFICATION_TYPES = [
  "EVENT_ASSIGNED",
  "EVENT_STATUS_CHANGED",
  "ISSUE_RAISED",
  "ISSUE_ESCALATED",
  "ISSUE_RESOLVED",
  "ISSUE_STATUS_CHANGED",
  "ISSUE_COMMENT",
  "ISSUE_WITHDRAWN",
  "SUBTASK_ASSIGNED",
  "SUBTASK_DUE_SOON",
  "SUBTASK_OVERDUE",
  "SUBTASK_COMPLETED",
  "TASK_SUBMITTED",
  "TASK_APPROVED",
  "TASK_REJECTED",
  "TASK_FORCE_COMPLETED",
  "SLA_WARNING",
  "SLA_BREACHED",
  "DEADLINE_WARNING",
  "TASK_ENDING_TODAY",
  "FINANCE_COLLECTION_SUBMITTED",
  "FINANCE_COLLECTION_APPROVED",
  "FINANCE_COLLECTION_REJECTED",
] as const;

/**
 * Idempotent: ensures every value in REQUIRED_NOTIFICATION_TYPES exists in
 * the Postgres `notification_type` enum. Safe to run any number of times.
 *
 * Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so
 * the caller must not wrap this in a tx.
 */
export async function syncNotificationTypeEnum(sql: Sql): Promise<void> {
  // Self-heal: create the enum on a fresh DB so this is safe to run anywhere.
  // Seed it with the first required value; the loop below adds the rest.
  await sql.unsafe(`
    DO $sync_nt$ BEGIN
      CREATE TYPE notification_type AS ENUM ('${REQUIRED_NOTIFICATION_TYPES[0]}');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $sync_nt$;
  `);

  const existing = await sql<{ v: string }[]>`
    SELECT unnest(enum_range(NULL::notification_type))::text AS v
  `;
  const have = new Set(existing.map((r) => r.v));
  const missing = REQUIRED_NOTIFICATION_TYPES.filter((v) => !have.has(v));

  if (missing.length === 0) {
    console.log("notification_type enum already up to date.");
    return;
  }

  console.log("Adding missing notification_type values:", missing.join(", "));
  for (const v of missing) {
    await sql.unsafe(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '${v}'`,
    );
  }
}

async function main() {
  const url = process.env.BSNL_DATABASE_URL;
  if (!url) throw new Error("BSNL_DATABASE_URL not set");

  const sql = postgres(url, { ssl: false });
  try {
    await syncNotificationTypeEnum(sql);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
