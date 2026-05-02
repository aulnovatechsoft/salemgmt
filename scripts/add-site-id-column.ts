/**
 * Idempotent migration: add `site_id` and `created_by` columns to
 * maintenance_entries. Safe to run multiple times.
 *
 *   bun run scripts/add-site-id-column.ts
 */
import postgres from "postgres";

const connectionString = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("BSNL_DATABASE_URL or DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: false, max: 1 });

async function main() {
  console.log("Adding site_id + created_by columns to maintenance_entries (if missing)…");
  await sql`ALTER TABLE maintenance_entries ADD COLUMN IF NOT EXISTS site_id text`;
  await sql`ALTER TABLE maintenance_entries ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES employees(id)`;
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'maintenance_entries'
    ORDER BY ordinal_position
  `;
  console.log("maintenance_entries columns now:");
  for (const c of cols) console.log(`  - ${c.column_name} (${c.data_type})`);
  await sql.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
