import { sql } from "drizzle-orm";
import { db } from "./index";

/**
 * Atomically allocate the next year-scoped sequential Task display ID,
 * formatted as `TSK-YYYY-NNNN` where YYYY is the current year in IST
 * (Asia/Kolkata) and NNNN is a 4-digit zero-padded sequence.
 *
 * Uses `task_id_counters(year, last_seq)` with `INSERT ... ON CONFLICT
 * DO UPDATE ... RETURNING` so concurrent creates never produce duplicates.
 *
 * Note: allocation is not transactional with the event INSERT, so a failed
 * insert leaves a gap in the sequence. That is acceptable.
 */
export async function allocateTaskDisplayId(): Promise<string> {
  const yearRows: any = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS year
  `);
  const year = Number(yearRows.rows?.[0]?.year ?? yearRows[0]?.year);

  const seqRows: any = await db.execute(sql`
    INSERT INTO task_id_counters (year, last_seq) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = task_id_counters.last_seq + 1
    RETURNING last_seq
  `);
  const nextSeq = Number(seqRows.rows?.[0]?.last_seq ?? seqRows[0]?.last_seq ?? 1);

  return `TSK-${year}-${String(nextSeq).padStart(4, '0')}`;
}
