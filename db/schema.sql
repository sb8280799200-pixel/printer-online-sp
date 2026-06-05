-- PostgreSQL schema for production deployment. MySQL can use equivalent VARCHAR/TEXT/JSON columns.
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user','admin')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shop_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  mono_price NUMERIC(10,2) NOT NULL DEFAULT 2.00,
  color_price NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  max_file_size_mb INTEGER NOT NULL DEFAULT 25,
  retention_hours INTEGER NOT NULL DEFAULT 24,
  upi_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  bank_account_ref TEXT,
  razorpay_key_id TEXT,
  phonepe_merchant_id TEXT,
  paytm_merchant_id TEXT,
  bharatpe_merchant_id TEXT,
  default_printer TEXT,
  printer_command TEXT,
  printer_endpoint TEXT,
  virus_scan_command TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE print_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  stored_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  page_count INTEGER NOT NULL,
  print_type VARCHAR(12) CHECK (print_type IN ('mono','color')),
  copies INTEGER NOT NULL DEFAULT 1,
  orientation VARCHAR(12) NOT NULL DEFAULT 'portrait',
  paper_size VARCHAR(8) NOT NULL DEFAULT 'A4',
  page_range_mode VARCHAR(12) NOT NULL DEFAULT 'all',
  custom_pages TEXT,
  billable_pages INTEGER,
  unit_price_rupees NUMERIC(10,2),
  amount_rupees NUMERIC(10,2),
  payment_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  print_status VARCHAR(16) NOT NULL DEFAULT 'not_ready',
  payment_reference TEXT,
  printer_message TEXT,
  paid_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX print_jobs_user_id_idx ON print_jobs(user_id);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES print_jobs(id),
  gateway VARCHAR(32) NOT NULL,
  amount_rupees NUMERIC(10,2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  payment_reference TEXT NOT NULL,
  gateway_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  user_id BIGINT REFERENCES users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
