import postgres from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

async function run() {
  const sql = postgres(connectionString, { ssl: false });

  console.log("Ensuring display_id column on events...");
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS display_id varchar(32)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS events_display_id_unique ON events (display_id)`;

  console.log("Migrating task_id_counters to (year, month) composite key...");
  // Add month column if missing (older deployments had only year as PK).
  await sql`ALTER TABLE task_id_counters ADD COLUMN IF NOT EXISTS month integer`;
  // Drop the old year-only PK if present (best effort) and create the composite PK.
  await sql.unsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'task_id_counters' AND constraint_type = 'PRIMARY KEY'
      ) THEN
        EXECUTE (
          SELECT 'ALTER TABLE task_id_counters DROP CONSTRAINT ' || quote_ident(constraint_name)
          FROM information_schema.table_constraints
          WHERE table_name = 'task_id_counters' AND constraint_type = 'PRIMARY KEY'
          LIMIT 1
        );
      END IF;
    END $$;
  `);
  // Wipe old year-only counter rows; they'll be recomputed below from event data.
  await sql`DELETE FROM task_id_counters WHERE month IS NULL`;
  await sql`ALTER TABLE task_id_counters ALTER COLUMN month SET NOT NULL`;
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'task_id_counters' AND constraint_type = 'PRIMARY KEY'
      ) THEN
        ALTER TABLE task_id_counters ADD PRIMARY KEY (year, month);
      END IF;
    END $$;
  `);

  console.log("Re-assigning display_id for ALL events in YYYY-MM-NNNN format...");
  // Clear so we can re-issue under the new format. Safe: display_id is only
  // a presentation field; UUID id is unchanged and remains the foreign key.
  await sql`UPDATE events SET display_id = NULL`;

  const rows = await sql<{ id: string; year: number; month: number }[]>`
    SELECT
      id,
      EXTRACT(YEAR  FROM (created_at AT TIME ZONE 'Asia/Kolkata'))::int AS year,
      EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Kolkata'))::int AS month
    FROM events
    ORDER BY created_at ASC, id ASC
  `;

  const perYM = new Map<string, number>(); // key: "YYYY-MM"
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    const next = (perYM.get(key) ?? 0) + 1;
    perYM.set(key, next);
    const displayId = `TSK-${r.year}-${String(r.month).padStart(2, '0')}-${String(next).padStart(4, '0')}`;
    await sql`UPDATE events SET display_id = ${displayId} WHERE id = ${r.id}`;
  }
  console.log(`Re-assigned ${rows.length} display IDs.`);

  // Sync counters so future allocations continue from the right number.
  for (const [key, lastSeq] of perYM.entries()) {
    const [yStr, mStr] = key.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    await sql`
      INSERT INTO task_id_counters (year, month, last_seq) VALUES (${year}, ${month}, ${lastSeq})
      ON CONFLICT (year, month) DO UPDATE SET last_seq = GREATEST(task_id_counters.last_seq, EXCLUDED.last_seq)
    `;
  }
  console.log("Counters synced.");

  console.log("Done.");
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
