import { sql } from "drizzle-orm";
import { db } from "./index";

/**
 * Atomically allocate the next year+month-scoped sequential Issue display ID,
 * formatted as `ISS-YYYY-MM-NNNN`. Mirrors `allocateTaskDisplayId` so concurrent
 * issue creates never produce duplicate display IDs.
 */
export async function allocateIssueDisplayId(): Promise<string> {
  const ymRows: any = await db.execute(sql`
    SELECT
      EXTRACT(YEAR  FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS year,
      EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS month
  `);
  const year = Number(ymRows.rows?.[0]?.year ?? ymRows[0]?.year);
  const month = Number(ymRows.rows?.[0]?.month ?? ymRows[0]?.month);

  const seqRows: any = await db.execute(sql`
    INSERT INTO issue_id_counters (year, month, last_seq) VALUES (${year}, ${month}, 1)
    ON CONFLICT (year, month) DO UPDATE SET last_seq = issue_id_counters.last_seq + 1
    RETURNING last_seq
  `);
  const nextSeq = Number(seqRows.rows?.[0]?.last_seq ?? seqRows[0]?.last_seq ?? 1);

  return `ISS-${year}-${String(month).padStart(2, '0')}-${String(nextSeq).padStart(4, '0')}`;
}
