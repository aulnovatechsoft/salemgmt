import { db, ftthOrderPending } from "../backend/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function importFtthPending() {
  console.log("Creating table if not exists...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ftth_order_pending (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pers_no VARCHAR(50) NOT NULL,
      ba VARCHAR(50) NOT NULL,
      total_ftth_orders_pending INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ftth_order_pending_pers_no ON ftth_order_pending(pers_no)
  `);
  
  console.log("Table created/verified successfully");
  
  const csvPath = path.join(process.cwd(), "attached_assets/FTTH_Order_pending__BBM_PER_NO.xlsx_-_BBM_details_1769770676021.csv");
  
  console.log("Reading CSV file:", csvPath);
  
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split("\n");
  
  console.log("Total lines in CSV:", lines.length);
  
  const header = lines[0].split(",");
  console.log("Header:", header);
  
  const records: { persNo: string; ba: string; totalFtthOrdersPending: number }[] = [];
  let skipped = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(",");
    const persNo = parts[0]?.trim() || "";
    const ba = parts[1]?.trim() || "";
    const pendingOrders = parseInt(parts[2]?.trim() || "0", 10) || 0;
    
    if (!persNo) {
      skipped++;
      continue;
    }
    
    records.push({
      persNo,
      ba,
      totalFtthOrdersPending: pendingOrders,
    });
  }
  
  console.log("Valid records to import:", records.length);
  console.log("Skipped (empty PERS_NO):", skipped);
  
  console.log("Clearing existing data...");
  await db.delete(ftthOrderPending);
  
  console.log("Importing data in batches...");
  const batchSize = 100;
  let imported = 0;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await db.insert(ftthOrderPending).values(batch);
    imported += batch.length;
    
    if (imported % 500 === 0) {
      console.log(`Imported ${imported}/${records.length} records...`);
    }
  }
  
  console.log(`Import complete! Total imported: ${imported} records`);
  
  const summary = await db.select({
    count: db.$count(ftthOrderPending),
  }).from(ftthOrderPending);
  
  console.log("Verification - Records in database:", summary);
  
  process.exit(0);
}

importFtthPending().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
