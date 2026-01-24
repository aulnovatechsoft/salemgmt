import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

const CIRCLES_DATA = [
  { value: 'ANDAMAN_NICOBAR', label: 'Andaman & Nicobar' },
  { value: 'ANDHRA_PRADESH', label: 'Andhra Pradesh' },
  { value: 'ASSAM', label: 'Assam' },
  { value: 'BIHAR', label: 'Bihar' },
  { value: 'CHHATTISGARH', label: 'Chhattisgarh' },
  { value: 'GUJARAT', label: 'Gujarat' },
  { value: 'HARYANA', label: 'Haryana' },
  { value: 'HIMACHAL_PRADESH', label: 'Himachal Pradesh' },
  { value: 'JAMMU_KASHMIR', label: 'Jammu & Kashmir' },
  { value: 'JHARKHAND', label: 'Jharkhand' },
  { value: 'KARNATAKA', label: 'Karnataka' },
  { value: 'KERALA', label: 'Kerala' },
  { value: 'MADHYA_PRADESH', label: 'Madhya Pradesh' },
  { value: 'MAHARASHTRA', label: 'Maharashtra' },
  { value: 'NORTH_EAST_I', label: 'North East-I' },
  { value: 'NORTH_EAST_II', label: 'North East-II' },
  { value: 'ODISHA', label: 'Odisha' },
  { value: 'PUNJAB', label: 'Punjab' },
  { value: 'RAJASTHAN', label: 'Rajasthan' },
  { value: 'TAMIL_NADU', label: 'Tamil Nadu' },
  { value: 'TELANGANA', label: 'Telangana' },
  { value: 'UTTARAKHAND', label: 'Uttarakhand' },
  { value: 'UTTAR_PRADESH_EAST', label: 'Uttar Pradesh (East)' },
  { value: 'UTTAR_PRADESH_WEST', label: 'Uttar Pradesh (West)' },
  { value: 'WEST_BENGAL', label: 'West Bengal' },
];

async function seedCircles() {
  const sql = postgres(connectionString, { ssl: 'require' });

  console.log('Creating circles table and seeding data...');

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS circles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value VARCHAR(50) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `;
    console.log('Circles table created (or already exists)');

    for (const circle of CIRCLES_DATA) {
      await sql`
        INSERT INTO circles (value, label)
        VALUES (${circle.value}, ${circle.label})
        ON CONFLICT (value) DO UPDATE SET label = ${circle.label}
      `;
      console.log(`Inserted/Updated circle: ${circle.label}`);
    }

    console.log('All circles seeded successfully!');

    const count = await sql`SELECT COUNT(*) FROM circles`;
    console.log(`Total circles in database: ${count[0].count}`);

    await sql.end();
    console.log('Done!');
  } catch (error) {
    console.error('Error seeding circles:', error);
    await sql.end();
    throw error;
  }
}

seedCircles();
