import postgres from "postgres";
import type { Sql } from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

/**
 * Idempotent migration: adds the optional extras the issue UX needs.
 *  · `priority` column on `issues` (reuses `subtask_priority` enum,
 *    default 'medium' so existing rows are valid).
 *  · `issue_comments` table for the per-issue discussion thread,
 *    with a FK to issues (ON DELETE CASCADE so comments disappear if
 *    an issue is ever hard-deleted) and a FK to employees for the
 *    author. Indexed by `issue_id, created_at` so the timeline view
 *    can range-scan efficiently.
 *
 * Safe to run any number of times. Registered in `migrate.ts` so a
 * single `bun run backend/db/migrate.ts` brings new envs up.
 */
export async function syncIssueExtras(sql: Sql): Promise<void> {
  console.log("Ensuring issues.priority column...");
  await sql`
    ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS priority subtask_priority NOT NULL DEFAULT 'medium'
  `;

  console.log("Ensuring issue_comments table...");
  await sql`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES employees(id),
      body text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS issue_comments_issue_created_idx
    ON issue_comments (issue_id, created_at)
  `;
  console.log("Issue extras ready.");
}

async function main() {
  const sql = postgres(connectionString, { ssl: false });
  try {
    await syncIssueExtras(sql);
    console.log("Done.");
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
