-- Scrap Express database schema

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrap_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'kg',
  price NUMERIC(10,2) NOT NULL,
  icon VARCHAR(50) NOT NULL DEFAULT 'default',
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pickup_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(150),
  address TEXT NOT NULL,
  area VARCHAR(100),
  pincode VARCHAR(10),
  scrap_type VARCHAR(150) NOT NULL,
  approx_quantity VARCHAR(50),
  preferred_date DATE,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS testimonials (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(150) NOT NULL,
  area VARCHAR(100),
  rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS demolition_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(150),
  building_type VARCHAR(100) NOT NULL,
  location TEXT NOT NULL,
  approx_area VARCHAR(50),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- B2B fields, added after launch; ADD COLUMN IF NOT EXISTS keeps this safe to
-- re-run against databases that already have data.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS business_type VARCHAR(100);
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS pickup_frequency VARCHAR(50);
-- Holds a comma-separated list now that several scrap types can be ticked.
ALTER TABLE pickup_requests ALTER COLUMN scrap_type TYPE TEXT;

-- Customer accounts. Firebase proves who someone is (Google or phone OTP);
-- everything else about the customer lives here.
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  verified_phone VARCHAR(20),
  email VARCHAR(200),
  name VARCHAR(150),
  phone VARCHAR(20),
  company_name VARCHAR(200),
  business_type VARCHAR(100),
  gstin VARCHAR(15),
  address TEXT,
  area VARCHAR(100),
  pincode VARCHAR(10),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);

ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pickup_requests_customer ON pickup_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_demolition_requests_customer ON demolition_requests(customer_id);

-- Quotes sent from the admin dashboard. quote_items is a list of
-- {material, rate, unit} lines; quote_response is the customer's answer
-- ('accepted' / 'declined'), kept even after the status moves on.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quote_items JSONB;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quote_note TEXT;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMP;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quote_response VARCHAR(10);
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quote_responded_at TIMESTAMP;

-- Photos and videos customers attach to a request. The files themselves
-- live on disk (lib/media.js); one row per file.
CREATE TABLE IF NOT EXISTS request_media (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('pickup', 'demolition')),
  request_id INT NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('photo', 'video')),
  file_name VARCHAR(100) UNIQUE NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(50) NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_media_request ON request_media(request_type, request_id);

-- Small key/value store for app settings, e.g. the push notification keys
-- (generated on first start, so nothing has to be configured by hand).
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Phones/browsers that turned on notifications. One row per device; a device
-- can belong to a customer, to the admin, or both (the owner testing).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_customer ON push_subscriptions(customer_id);

-- Daily rates & news subscribers (email and/or WhatsApp number). Email
-- addresses must be confirmed from a link before anything is sent to them.
CREATE TABLE IF NOT EXISTS subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(200) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  token VARCHAR(64) UNIQUE NOT NULL,
  email_confirmed_at TIMESTAMP,
  confirmation_sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Phones/browsers that tapped "Get price alerts" (no login needed).
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS wants_updates BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pickup_requests_status ON pickup_requests(status);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_created_at ON pickup_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demolition_requests_status ON demolition_requests(status);
CREATE INDEX IF NOT EXISTS idx_demolition_requests_created_at ON demolition_requests(created_at DESC);
