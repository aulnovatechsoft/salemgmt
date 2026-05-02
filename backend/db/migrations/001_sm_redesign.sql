-- Chunk A migration: S&M submission flow redesign
-- Adds line-item child tables + status/audit columns to event_sales_entries
-- Idempotent: safe to re-run.

BEGIN;

-- 1) New enum for entry lifecycle status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_entry_status') THEN
    CREATE TYPE sales_entry_status AS ENUM ('active', 'superseded', 'deleted');
  END IF;
END $$;

-- 2) Add audit/status columns to event_sales_entries
ALTER TABLE event_sales_entries
  ADD COLUMN IF NOT EXISTS entry_status sales_entry_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS review_status sales_report_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS review_remarks text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

-- 3) SIM sale lines
CREATE TABLE IF NOT EXISTS sim_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES event_sales_entries(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  mobile_number varchar(15) NOT NULL,
  sim_serial_number varchar(50),
  customer_name varchar(255),
  customer_type customer_type,
  is_activated boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_lines_entry ON sim_sale_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_sim_lines_event ON sim_sale_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_sim_lines_mobile ON sim_sale_lines(mobile_number);

-- 4) FTTH sale lines
CREATE TABLE IF NOT EXISTS ftth_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES event_sales_entries(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  ftth_id varchar(50) NOT NULL,
  customer_name varchar(255),
  customer_contact varchar(20),
  customer_type customer_type,
  plan_name varchar(100),
  is_activated boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ftth_lines_entry ON ftth_sale_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_ftth_lines_event ON ftth_sale_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_ftth_lines_ftth_id ON ftth_sale_lines(ftth_id);

-- 5) Lease Circuit lines
CREATE TABLE IF NOT EXISTS lc_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES event_sales_entries(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  circuit_id varchar(100) NOT NULL,
  customer_name varchar(255) NOT NULL,
  customer_contact varchar(20),
  customer_type customer_type,
  bandwidth varchar(50),
  endpoint_a varchar(255),
  endpoint_b varchar(255),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lc_lines_entry ON lc_sale_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lc_lines_event ON lc_sale_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_lc_lines_circuit ON lc_sale_lines(circuit_id);

-- 6) EB Connection lines
CREATE TABLE IF NOT EXISTS eb_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES event_sales_entries(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  connection_id varchar(100) NOT NULL,
  meter_number varchar(100),
  customer_name varchar(255) NOT NULL,
  customer_contact varchar(20),
  customer_type customer_type,
  site_address text,
  load_kw varchar(50),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eb_lines_entry ON eb_sale_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_eb_lines_event ON eb_sale_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_eb_lines_conn ON eb_sale_lines(connection_id);

COMMIT;
