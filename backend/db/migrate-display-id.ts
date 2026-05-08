import postgres from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

async function run() {
  const sql = postgres(connectionString, { ssl: false });

  console.log("Adding display_id to events + counter table...");

  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS display_id varchar(32)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS events_display_id_unique ON events (display_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS task_id_counters (
      year integer PRIMARY KEY,
      last_seq integer NOT NULL DEFAULT 0
    )
  `;

  console.log("Backfilling display_id for existing rows...");

  const rows = await sql<{ id: string; year: number }[]>`
    SELECT id, EXTRACT(YEAR FROM created_at)::int AS year
    FROM events
    WHERE display_id IS NULL
    ORDER BY created_at ASC, id ASC
  `;

  const perYear = new Map<number, number>();
  const existing = await sql<{ year: number; max_seq: number }[]>`
    SELECT
      CAST(SPLIT_PART(display_id, '-', 2) AS int) AS year,
      MAX(CAST(SPLIT_PART(display_id, '-', 3) AS int)) AS max_seq
    FROM events
    WHERE display_id IS NOT NULL AND display_id LIKE 'TSK-%-%'
    GROUP BY 1
  `;
  for (const e of existing) perYear.set(e.year, e.max_seq);

  if (rows.length === 0) {
    console.log("No rows to backfill.");
  } else {
    for (const r of rows) {
      const next = (perYear.get(r.year) ?? 0) + 1;
      perYear.set(r.year, next);
      const displayId = `TSK-${r.year}-${String(next).padStart(4, '0')}`;
      await sql`UPDATE events SET display_id = ${displayId} WHERE id = ${r.id}`;
    }
    console.log(`Backfilled ${rows.length} rows.`);
  }

  // Always sync counters with the max existing sequence per year, even if
  // no backfill rows were found, to prevent duplicate IDs on next allocation.
  for (const [year, lastSeq] of perYear.entries()) {
    await sql`
      INSERT INTO task_id_counters (year, last_seq) VALUES (${year}, ${lastSeq})
      ON CONFLICT (year) DO UPDATE SET last_seq = GREATEST(task_id_counters.last_seq, EXCLUDED.last_seq)
    `;
  }
  console.log("Synced task_id_counters with current per-year max sequences.");

  console.log("Done.");
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
