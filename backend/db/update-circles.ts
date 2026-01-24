import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

async function updateCircles() {
  const sql = postgres(connectionString, { ssl: 'require' });

  console.log('Updating bsnl_circle enum with all circles...');

  try {
    const newCircles = [
      'ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH',
      'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND',
      'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'NORTH_EAST_I',
      'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU',
      'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'
    ];

    for (const circle of newCircles) {
      try {
        await sql.unsafe(`ALTER TYPE bsnl_circle ADD VALUE IF NOT EXISTS '${circle}'`);
        console.log(`Added circle: ${circle}`);
      } catch (err: any) {
        if (err.code === '42710') {
          console.log(`Circle already exists: ${circle}`);
        } else {
          console.log(`Note for ${circle}: ${err.message}`);
        }
      }
    }

    console.log('Enum updated successfully!');

    const resourceTypes = ['SIM', 'FTTH'];
    for (const resourceType of resourceTypes) {
      for (const circle of newCircles) {
        await sql`
          INSERT INTO resources (type, circle, total, allocated, used, remaining)
          VALUES (${resourceType}, ${circle}, 10000, 0, 0, 10000)
          ON CONFLICT DO NOTHING;
        `;
      }
    }
    console.log('Resources seeded for new circles');

    await sql.end();
    console.log('Done!');
  } catch (error) {
    console.error('Error updating circles:', error);
    await sql.end();
    throw error;
  }
}

updateCircles();
