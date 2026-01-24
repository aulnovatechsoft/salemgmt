import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

async function createTables() {
  const sql = postgres(connectionString, { ssl: 'require' });

  console.log('Creating database tables...');

  try {
    await sql.unsafe(`
      DO $user_role$ BEGIN
        CREATE TYPE user_role AS ENUM ('GM', 'CGM', 'DGM', 'AGM', 'SD_JTO', 'SALES_STAFF');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $user_role$;
    `);

    await sql.unsafe(`
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SD_JTO';
    `).catch(() => {});

    await sql`
      DO $bsnl$ BEGIN
        CREATE TYPE bsnl_circle AS ENUM (
          'ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH',
          'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND',
          'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I',
          'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU',
          'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $bsnl$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE event_category AS ENUM ('Cultural', 'Religious', 'Sports', 'Exhibition', 'Fair', 'Festival', 'Agri-Tourism', 'Eco-Tourism', 'Trade/Religious');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE issue_type AS ENUM ('MATERIAL_SHORTAGE', 'SITE_ACCESS', 'EQUIPMENT', 'NETWORK_PROBLEM', 'OTHER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE issue_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE customer_type AS ENUM ('B2C', 'B2B', 'Government', 'Enterprise');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $resource$ BEGIN
        CREATE TYPE resource_type AS ENUM ('SIM', 'FTTH');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $resource$;
    `;

    await sql`
      DO $subtask_status$ BEGIN
        CREATE TYPE subtask_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $subtask_status$;
    `;

    await sql`
      DO $subtask_priority$ BEGIN
        CREATE TYPE subtask_priority AS ENUM ('low', 'medium', 'high', 'urgent');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $subtask_priority$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE audit_entity_type AS ENUM ('EVENT', 'SALES', 'RESOURCE', 'ISSUE', 'EMPLOYEE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    console.log('Enums created successfully');

    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(20) NOT NULL,
        password VARCHAR(255),
        role user_role NOT NULL,
        circle bsnl_circle NOT NULL,
        zone VARCHAR(100) NOT NULL,
        reporting_officer_id UUID,
        employee_no VARCHAR(50),
        designation VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('employees table created');

    await sql`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        location TEXT NOT NULL,
        circle bsnl_circle NOT NULL,
        zone VARCHAR(100) NOT NULL,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        category event_category NOT NULL,
        target_sim INTEGER DEFAULT 0 NOT NULL,
        target_ftth INTEGER DEFAULT 0 NOT NULL,
        assigned_team JSONB DEFAULT '[]',
        allocated_sim INTEGER DEFAULT 0 NOT NULL,
        allocated_ftth INTEGER DEFAULT 0 NOT NULL,
        key_insight TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_by UUID NOT NULL REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('events table created');

    await sql`
      CREATE TABLE IF NOT EXISTS sales_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        sales_staff_id UUID NOT NULL REFERENCES employees(id),
        sims_sold INTEGER DEFAULT 0 NOT NULL,
        sims_activated INTEGER DEFAULT 0 NOT NULL,
        ftth_leads INTEGER DEFAULT 0 NOT NULL,
        ftth_installed INTEGER DEFAULT 0 NOT NULL,
        customer_type customer_type NOT NULL,
        photos JSONB DEFAULT '[]',
        gps_latitude TEXT,
        gps_longitude TEXT,
        remarks TEXT,
        synced BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('sales_reports table created');

    await sql`
      CREATE TABLE IF NOT EXISTS resources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type resource_type NOT NULL,
        circle bsnl_circle NOT NULL,
        total INTEGER DEFAULT 0 NOT NULL,
        allocated INTEGER DEFAULT 0 NOT NULL,
        used INTEGER DEFAULT 0 NOT NULL,
        remaining INTEGER DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    
    console.log('resources table created');

    await sql`
      CREATE TABLE IF NOT EXISTS issues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        raised_by UUID NOT NULL REFERENCES employees(id),
        type issue_type NOT NULL,
        description TEXT NOT NULL,
        status issue_status DEFAULT 'OPEN' NOT NULL,
        escalated_to UUID REFERENCES employees(id),
        resolved_by UUID REFERENCES employees(id),
        resolved_at TIMESTAMP,
        timeline JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('issues table created');

    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action VARCHAR(255) NOT NULL,
        entity_type audit_entity_type NOT NULL,
        entity_id UUID NOT NULL,
        performed_by UUID NOT NULL REFERENCES employees(id),
        details JSONB DEFAULT '{}',
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('audit_logs table created');

    await sql`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        identifier VARCHAR(255) NOT NULL,
        type VARCHAR(10) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('otp_verifications table created');

    await sql`
      CREATE TABLE IF NOT EXISTS event_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        employee_id UUID NOT NULL REFERENCES employees(id),
        sim_target INTEGER DEFAULT 0 NOT NULL,
        ftth_target INTEGER DEFAULT 0 NOT NULL,
        sim_sold INTEGER DEFAULT 0 NOT NULL,
        ftth_sold INTEGER DEFAULT 0 NOT NULL,
        assigned_by UUID REFERENCES employees(id),
        assigned_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(event_id, employee_id)
      );
    `;
    console.log('event_assignments table created');

    // Add columns if they don't exist (for existing databases)
    try {
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS sim_target INTEGER DEFAULT 0 NOT NULL`;
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS ftth_target INTEGER DEFAULT 0 NOT NULL`;
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS sim_sold INTEGER DEFAULT 0 NOT NULL`;
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS ftth_sold INTEGER DEFAULT 0 NOT NULL`;
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES employees(id)`;
      await sql`ALTER TABLE event_assignments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL`;
    } catch (e) {
      console.log('event_assignments columns may already exist');
    }
    console.log('event_assignments columns updated');

    await sql`
      CREATE TABLE IF NOT EXISTS event_sales_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        employee_id UUID NOT NULL REFERENCES employees(id),
        sims_sold INTEGER DEFAULT 0 NOT NULL,
        sims_activated INTEGER DEFAULT 0 NOT NULL,
        ftth_sold INTEGER DEFAULT 0 NOT NULL,
        ftth_activated INTEGER DEFAULT 0 NOT NULL,
        customer_type customer_type NOT NULL,
        photos JSONB DEFAULT '[]',
        gps_latitude TEXT,
        gps_longitude TEXT,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('event_sales_entries table created');

    await sql`CREATE INDEX IF NOT EXISTS idx_event_sales_entries_event ON event_sales_entries(event_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_sales_entries_employee ON event_sales_entries(employee_id);`;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_allocations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id UUID NOT NULL REFERENCES resources(id),
        event_id UUID NOT NULL REFERENCES events(id),
        quantity INTEGER DEFAULT 0 NOT NULL,
        allocated_by UUID NOT NULL REFERENCES employees(id),
        allocated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('resource_allocations table created');

    await sql`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value VARCHAR(50) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        hierarchy INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('roles table created');

    await sql`
      CREATE TABLE IF NOT EXISTS circles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value VARCHAR(50) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('circles table created');

    await sql`CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees(phone);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);`;
    
    
    await sql`CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_reports_event ON sales_reports(event_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_reports_staff ON sales_reports(sales_staff_id);`;

    // Add sales report approval columns
    try {
      await sql`ALTER TABLE sales_reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' NOT NULL`;
      await sql`ALTER TABLE sales_reports ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES employees(id)`;
      await sql`ALTER TABLE sales_reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`;
      await sql`ALTER TABLE sales_reports ADD COLUMN IF NOT EXISTS review_remarks TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sales_reports_status ON sales_reports(status);`;
      console.log('sales_reports approval columns added');
    } catch (e) {
      console.log('sales_reports approval columns may already exist');
    }
    await sql`CREATE INDEX IF NOT EXISTS idx_issues_event ON issues(event_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by ON audit_logs(performed_by);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_verifications(identifier);`;

    console.log('Indexes created successfully');

    const circles = [
      'ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH',
      'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND',
      'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I',
      'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU',
      'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'
    ];
    const resourceTypes = ['SIM', 'FTTH'];
    
    for (const resourceType of resourceTypes) {
      for (const circleVal of circles) {
        await sql`
          INSERT INTO resources (type, circle, total, allocated, used, remaining)
          VALUES (${resourceType}, ${circleVal}, 10000, 0, 0, 10000)
          ON CONFLICT DO NOTHING;
        `;
      }
    }
    console.log('Initial resources seeded');

    const rolesData = [
      { value: 'GM', label: 'GM (Multi-Circle)', hierarchy: 6 },
      { value: 'CGM', label: 'CGM (Circle)', hierarchy: 5 },
      { value: 'DGM', label: 'DGM (Zone)', hierarchy: 4 },
      { value: 'AGM', label: 'AGM (Team/Event)', hierarchy: 3 },
      { value: 'SD_JTO', label: 'SD/JTO', hierarchy: 2 },
      { value: 'SALES_STAFF', label: 'Sales Staff', hierarchy: 1 },
    ];

    for (const role of rolesData) {
      await sql`
        INSERT INTO roles (value, label, hierarchy)
        VALUES (${role.value}, ${role.label}, ${role.hierarchy})
        ON CONFLICT (value) DO UPDATE SET label = ${role.label}, hierarchy = ${role.hierarchy};
      `;
    }
    console.log('Initial roles seeded');

    const circlesData = [
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

    for (const circle of circlesData) {
      await sql`
        INSERT INTO circles (value, label)
        VALUES (${circle.value}, ${circle.label})
        ON CONFLICT (value) DO UPDATE SET label = ${circle.label};
      `;
    }
    console.log('Initial circles seeded');

    await sql`
      CREATE TABLE IF NOT EXISTS division_master (
        division_id INTEGER PRIMARY KEY,
        division_name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('division_master table created');

    await sql`
      CREATE TABLE IF NOT EXISTS event_subtasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assigned_to UUID REFERENCES employees(id),
        status subtask_status DEFAULT 'pending' NOT NULL,
        priority subtask_priority DEFAULT 'medium' NOT NULL,
        due_date TIMESTAMP,
        completed_at TIMESTAMP,
        completed_by UUID REFERENCES employees(id),
        created_by UUID NOT NULL REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('event_subtasks table created');

    await sql`CREATE INDEX IF NOT EXISTS idx_event_subtasks_event ON event_subtasks(event_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_subtasks_assigned ON event_subtasks(assigned_to);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_subtasks_status ON event_subtasks(status);`;

    const divisionsData = [
      { id: 1, name: 'Commercial' },
      { id: 2, name: 'Marketing' },
      { id: 3, name: 'Enterprise Business' },
      { id: 4, name: 'Retail Sales' },
      { id: 5, name: 'Business Development' },
      { id: 6, name: 'Customer Service' },
      { id: 7, name: 'Revenue & Billing' },
      { id: 8, name: 'Network Operations' },
      { id: 9, name: 'Transmission' },
      { id: 10, name: 'Switching' },
      { id: 11, name: 'Mobile Services' },
      { id: 12, name: 'Fixed Line' },
      { id: 13, name: 'FTTH / Broadband' },
      { id: 14, name: 'IP / MPLS' },
      { id: 15, name: 'NOC' },
      { id: 16, name: 'RF / Radio Planning' },
      { id: 17, name: 'Planning' },
      { id: 18, name: 'Project Management' },
      { id: 19, name: 'Infrastructure Development' },
      { id: 20, name: 'Optical Fiber (OFC)' },
      { id: 21, name: 'Civil Works' },
      { id: 22, name: 'Electrical' },
      { id: 23, name: 'Power & Energy' },
      { id: 24, name: 'IT' },
      { id: 25, name: 'Software / Applications' },
      { id: 26, name: 'Data Center' },
      { id: 27, name: 'Cyber Security' },
      { id: 28, name: 'ERP / SAP' },
      { id: 29, name: 'Digital Services' },
      { id: 30, name: 'HR / Personnel' },
      { id: 31, name: 'Administration' },
      { id: 32, name: 'Establishment' },
      { id: 33, name: 'Training' },
      { id: 34, name: 'ALTTC' },
      { id: 35, name: 'Vigilance' },
      { id: 36, name: 'Legal' },
      { id: 37, name: 'Finance' },
      { id: 38, name: 'Accounts' },
      { id: 39, name: 'Audit' },
      { id: 40, name: 'Budget & Costing' },
      { id: 41, name: 'Revenue Assurance' },
      { id: 42, name: 'Inspection' },
      { id: 43, name: 'Quality Assurance' },
      { id: 44, name: 'Performance Monitoring' },
      { id: 45, name: 'Stores' },
      { id: 46, name: 'Procurement' },
      { id: 47, name: 'Inventory' },
      { id: 48, name: 'Transport' },
      { id: 49, name: 'Security' },
      { id: 50, name: 'Corporate Office' },
      { id: 51, name: 'ITPC' },
      { id: 52, name: 'CN-TX' },
      { id: 53, name: 'Telecom Factory' },
      { id: 54, name: 'Special Projects' },
      { id: 55, name: 'R&D / Research' },
    ];

    for (const division of divisionsData) {
      await sql`
        INSERT INTO division_master (division_id, division_name)
        VALUES (${division.id}, ${division.name})
        ON CONFLICT (division_id) DO UPDATE SET division_name = ${division.name};
      `;
    }
    console.log('Initial divisions seeded');

    await sql`
      CREATE TABLE IF NOT EXISTS employee_master (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purse_id VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        circle VARCHAR(100),
        zone VARCHAR(100),
        designation VARCHAR(100),
        reporting_purse_id VARCHAR(50),
        employee_id VARCHAR(50),
        is_linked BOOLEAN DEFAULT false,
        linked_employee_id UUID REFERENCES employees(id),
        linked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('employee_master table created');

    await sql`CREATE INDEX IF NOT EXISTS idx_employee_master_purse_id ON employee_master(purse_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_employee_master_reporting ON employee_master(reporting_purse_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_employee_master_linked ON employee_master(linked_employee_id);`;

    console.log('All tables created successfully!');
    await sql.end();
  } catch (error) {
    console.error('Error creating tables:', error);
    await sql.end();
    throw error;
  }
}

createTables();
