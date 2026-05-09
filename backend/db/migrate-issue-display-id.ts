import postgres from "postgres";
import type { Sql } from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

/**
 * Idempotent: adds `display_id` (ISS-YYYY-MM-NNNN) to the issues table,
 * creates the `issue_id_counters` table, and backfills any existing
 * issue rows that don't yet have a display_id. Safe to run any number
 * of times.
 *
 * Mirrors the events `display_id` / `task_id_counters` pattern so the
 * UX is identical for users (each issue gets a short shareable id).
 */
export async function syncIssueDisplayId(sql: Sql): Promise<void> {
  console.log("Ensuring display_id column on issues...");
  await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS display_id varchar(32)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS issues_display_id_unique ON issues (display_id)`;

  console.log("Ensuring issue_id_counters table...");
  await sql`
    CREATE TABLE IF NOT EXISTS issue_id_counters (
      year integer NOT NULL,
      month integer NOT NULL,
      last_seq integer NOT NULL DEFAULT 0,
      PRIMARY KEY (year, month)
    )
  `;

  const rows = await sql<{ id: string; year: number; month: number }[]>`
    SELECT
      id,
      EXTRACT(YEAR  FROM (created_at AT TIME ZONE 'Asia/Kolkata'))::int AS year,
      EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Kolkata'))::int AS month
    FROM issues
    WHERE display_id IS NULL
    ORDER BY created_at ASC, id ASC
  `;

  if (rows.length === 0) {
    console.log("All issues already have a display_id; nothing to backfill.");
    return;
  }

  // Seed in-memory counter from any existing counter rows so we don't
  // collide with the live allocator's sequence.
  const existing = await sql<{ year: number; month: number; last_seq: number }[]>`
    SELECT year, month, last_seq FROM issue_id_counters
  `;
  const perYM = new Map<string, number>();
  for (const e of existing) perYM.set(`${e.year}-${e.month}`, Number(e.last_seq));

  console.log(`Backfilling ${rows.length} issue display IDs...`);
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    const next = (perYM.get(key) ?? 0) + 1;
    perYM.set(key, next);
    const displayId = `ISS-${r.year}-${String(r.month).padStart(2, '0')}-${String(next).padStart(4, '0')}`;
    await sql`UPDATE issues SET display_id = ${displayId} WHERE id = ${r.id}`;
  }

  for (const [key, lastSeq] of perYM.entries()) {
    const [yStr, mStr] = key.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    await sql`
      INSERT INTO issue_id_counters (year, month, last_seq) VALUES (${year}, ${month}, ${lastSeq})
      ON CONFLICT (year, month) DO UPDATE SET last_seq = GREATEST(issue_id_counters.last_seq, EXCLUDED.last_seq)
    `;
  }
  console.log("Issue counters synced.");
}

async function main() {
  const sql = postgres(connectionString, { ssl: false });
  try {
    await syncIssueDisplayId(sql);
    console.log("Done.");
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
