import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

async function verifyTables() {
  const sql = postgres(connectionString, { ssl: false });

  try {
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    
    console.log('✅ Created Tables in Database:');
    tables.forEach(t => console.log('  -', t.table_name));
    console.log(`\nTotal: ${tables.length} tables`);

    const enums = await sql`
      SELECT t.typname as enum_name
      FROM pg_type t 
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public'
      ORDER BY t.typname
    `;
    
    console.log('\n✅ Created Enums:');
    enums.forEach(e => console.log('  -', e.enum_name));

    await sql.end();
  } catch (error) {
    console.error('Error:', error);
    await sql.end();
  }
}

verifyTables();
