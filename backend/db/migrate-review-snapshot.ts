import postgres from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL!;

async function run() {
  const sql = postgres(connectionString, { ssl: false });

  console.log("Adding review snapshot columns to event_assignments...");
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_resubmitted_at timestamp`;
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_submitted_snapshot jsonb`;
  await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS last_submission_note text`;

  console.log("Done.");
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
