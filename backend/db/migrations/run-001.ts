import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

const url = process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('No DB URL set');
  process.exit(1);
}

const sql = readFileSync(join(__dirname, '001_sm_redesign.sql'), 'utf8');

const client = postgres(url, { ssl: false, max: 1 });

(async () => {
  try {
    console.log('Applying 001_sm_redesign.sql ...');
    await client.unsafe(sql);
    console.log('OK: migration 001 applied');
  } catch (e) {
    console.error('FAILED:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
