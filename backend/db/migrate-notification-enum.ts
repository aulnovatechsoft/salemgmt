import postgres from "postgres";

const REQUIRED_NOTIFICATION_TYPES = [
  "EVENT_ASSIGNED",
  "EVENT_STATUS_CHANGED",
  "ISSUE_RAISED",
  "ISSUE_ESCALATED",
  "ISSUE_RESOLVED",
  "ISSUE_STATUS_CHANGED",
  "SUBTASK_ASSIGNED",
  "SUBTASK_DUE_SOON",
  "SUBTASK_OVERDUE",
  "SUBTASK_COMPLETED",
  "TASK_SUBMITTED",
  "TASK_APPROVED",
  "TASK_REJECTED",
  "SLA_WARNING",
  "SLA_BREACHED",
  "DEADLINE_WARNING",
  "TASK_ENDING_TODAY",
  "FINANCE_COLLECTION_SUBMITTED",
  "FINANCE_COLLECTION_APPROVED",
  "FINANCE_COLLECTION_REJECTED",
] as const;

async function main() {
  const url = process.env.BSNL_DATABASE_URL;
  if (!url) throw new Error("BSNL_DATABASE_URL not set");

  const sql = postgres(url, { ssl: false });
  try {
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
      // ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
      await sql.unsafe(
        `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '${v}'`,
      );
    }
    console.log("Done.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
