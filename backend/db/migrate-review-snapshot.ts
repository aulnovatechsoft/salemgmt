import postgres from "postgres";
import type { Sql } from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

/**
 * Idempotent: adds the rolling-submission columns to event_assignments.
 * Safe to run any number of times.
 */
export async function syncReviewSnapshotColumns(sql: Sql): Promise<void> {
  console.log("Ensuring review snapshot columns on event_assignments...");
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_resubmitted_at timestamp`;
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_submitted_snapshot jsonb`;
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_submission_note text`;
}

async function main() {
  const sql = postgres(connectionString, { ssl: false });
  try {
    await syncReviewSnapshotColumns(sql);
    console.log("Done.");
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
