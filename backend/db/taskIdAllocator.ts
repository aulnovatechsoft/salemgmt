import { sql } from "drizzle-orm";
import { db } from "./index";

/**
 * Atomically allocate the next year+month-scoped sequential Task display ID,
 * formatted as `TSK-YYYY-MM-NNNN` where YYYY-MM is the current year/month in
 * IST (Asia/Kolkata) and NNNN is a 4-digit zero-padded sequence that resets
 * each month.
 *
 * Uses `task_id_counters(year, month, last_seq)` keyed on (year, month) with
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` so concurrent creates
 * never produce duplicates.
 */
export async function allocateTaskDisplayId(): Promise<string> {
  const ymRows: any = await db.execute(sql`
    SELECT
      EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS year,
      EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS month
  `);
  const year = Number(ymRows.rows?.[0]?.year ?? ymRows[0]?.year);
  const month = Number(ymRows.rows?.[0]?.month ?? ymRows[0]?.month);

  const seqRows: any = await db.execute(sql`
    INSERT INTO task_id_counters (year, month, last_seq) VALUES (${year}, ${month}, 1)
    ON CONFLICT (year, month) DO UPDATE SET last_seq = task_id_counters.last_seq + 1
    RETURNING last_seq
  `);
  const nextSeq = Number(seqRows.rows?.[0]?.last_seq ?? seqRows[0]?.last_seq ?? 1);

  return `TSK-${year}-${String(month).padStart(2, '0')}-${String(nextSeq).padStart(4, '0')}`;
}
