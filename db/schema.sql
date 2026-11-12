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

-- When several scrap types are ticked, the quantity of each:
-- [{type, quantity, unit}]. approx_quantity then holds their total.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS item_quantities JSONB;

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

-- Longer addresses are accepted now, as on customer accounts.
ALTER TABLE pickup_requests ALTER COLUMN email TYPE VARCHAR(200);
ALTER TABLE demolition_requests ALTER COLUMN email TYPE VARCHAR(200);

-- Site location: an optional exact pin for the driver; the address columns
-- hold the separate form fields joined into one line.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS building VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS street VARCHAR(300);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS landmark VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state VARCHAR(100);

-- When the customer accepted the pickup rules, and which version.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);

-- Area from the same list as pickups, or "Other: <what the customer typed>".
ALTER TABLE demolition_requests ADD COLUMN IF NOT EXISTS area VARCHAR(100);

-- Step 1 of the pickup form, saved as soon as it's filled in, so the owner
-- can call a business that didn't finish step 2. When step 2 is sent, the
-- lead points at the full request it became.
CREATE TABLE IF NOT EXISTS pickup_leads (
  id SERIAL PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  company_name VARCHAR(200) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  scrap_type TEXT NOT NULL,
  approx_quantity VARCHAR(50) NOT NULL,
  item_quantities JSONB,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  request_id INT REFERENCES pickup_requests(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pickup_leads_open ON pickup_leads(created_at DESC) WHERE completed_at IS NULL;

-- Every status a request goes through, with the time (the customer's
-- timeline in My Account). The database records them itself.
CREATE TABLE IF NOT EXISTS request_events (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('pickup', 'demolition')),
  request_id INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_type, request_id, at);
CREATE OR REPLACE FUNCTION record_request_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO request_events (request_type, request_id, status) VALUES (TG_ARGV[0], NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER pickup_requests_events
  AFTER INSERT OR UPDATE OF status ON pickup_requests
  FOR EACH ROW EXECUTE FUNCTION record_request_event('pickup');
CREATE OR REPLACE TRIGGER demolition_requests_events
  AFTER INSERT OR UPDATE OF status ON demolition_requests
  FOR EACH ROW EXECUTE FUNCTION record_request_event('demolition');
-- Requests from before the timeline: rebuild what's known from their dates.
INSERT INTO request_events (request_type, request_id, status, at)
  SELECT 'pickup', p.id, e.status, e.at FROM pickup_requests p
  CROSS JOIN LATERAL (VALUES
    ('pending', p.created_at), ('quoted', p.quoted_at), (p.quote_response, p.quote_responded_at),
    ('ready', p.ready_at), ('confirmed', p.dispatch_checked_at)
  ) AS e(status, at)
  WHERE e.status IS NOT NULL AND e.at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM request_events x WHERE x.request_type = 'pickup' AND x.request_id = p.id);
INSERT INTO request_events (request_type, request_id, status, at)
  SELECT 'demolition', d.id, 'pending', d.created_at FROM demolition_requests d
  WHERE NOT EXISTS (SELECT 1 FROM request_events x WHERE x.request_type = 'demolition' AND x.request_id = d.id);

-- Weighbridge slips, GST invoices and other papers the team adds to a
-- request; the customer downloads them from My Account or the quote link.
CREATE TABLE IF NOT EXISTS request_documents (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('pickup', 'demolition')),
  request_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('weight_slip', 'invoice', 'other')),
  file_name VARCHAR(100) UNIQUE NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(50) NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_documents_request ON request_documents(request_type, request_id);

-- Repeat pickups a customer sets up from an earlier one. A new request is
-- created a couple of days before each date (lib/schedules.js).
CREATE TABLE IF NOT EXISTS pickup_schedules (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source_request_id INT REFERENCES pickup_requests(id) ON DELETE SET NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('once', 'weekly', 'fortnightly', 'monthly')),
  next_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_request_id INT REFERENCES pickup_requests(id) ON DELETE SET NULL,
  terms_version VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pickup_schedules_due ON pickup_schedules(next_date) WHERE active;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS schedule_id INT REFERENCES pickup_schedules(id) ON DELETE SET NULL;

-- Visits and conversions, counted per day (lib/analytics.js). Totals only:
-- no names, numbers, addresses or cookies.
CREATE TABLE IF NOT EXISTS analytics_daily (
  day DATE NOT NULL,
  event VARCHAR(40) NOT NULL,
  path VARCHAR(200) NOT NULL DEFAULT '',
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, path)
);

-- Lots of sorted scrap we sell to recyclers ("Buy from us"), and enquiries about them.
CREATE TABLE IF NOT EXISTS sale_lots (
  id SERIAL PRIMARY KEY,
  material VARCHAR(100) NOT NULL,
  title VARCHAR(150) NOT NULL,
  grade VARCHAR(150),
  quantity NUMERIC(12,2) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'kg',
  location VARCHAR(150),
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS lot_enquiries (
  id SERIAL PRIMARY KEY,
  lot_id INT REFERENCES sale_lots(id) ON DELETE SET NULL,
  lot_title VARCHAR(150),
  name VARCHAR(150) NOT NULL,
  company VARCHAR(200),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(200),
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lot_enquiries_created ON lot_enquiries(created_at DESC);

-- Photos for the public site (lib/site-images.js): the yard, weighbridge,
-- trucks and team; client logos (only with permission); and lot photos.
CREATE TABLE IF NOT EXISTS site_images (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('gallery', 'logo', 'lot')),
  category VARCHAR(30),
  alt_text VARCHAR(200) NOT NULL,
  caption VARCHAR(200),
  company_name VARCHAR(150),
  permission_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  lot_id INT REFERENCES sale_lots(id) ON DELETE CASCADE,
  file_name VARCHAR(100) UNIQUE NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  size_bytes INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_site_images_kind ON site_images(kind, sort_order);

-- Each area's own page (/areas/<slug>). Filled from data/areas.js by db/seed.js.
CREATE TABLE IF NOT EXISTS service_areas (
  slug VARCHAR(100) PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  region VARCHAR(100) NOT NULL,
  intro TEXT NOT NULL,
  industries TEXT[] NOT NULL DEFAULT '{}',
  nearby TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Rates page: each rate belongs to a group (the tabs), has its own page at
-- /rates/<slug> (filled in by db/seed.js), and keeps a history of its price
-- for the 30-day trend.
ALTER TABLE scrap_categories ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE scrap_categories ADD COLUMN IF NOT EXISTS slug VARCHAR(140);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrap_categories_slug ON scrap_categories(slug);
UPDATE scrap_categories SET category = CASE
    WHEN icon IN ('newspaper', 'book', 'box', 'hardboard', 'paper') THEN 'paper'
    WHEN icon IN ('pipe', 'granules', 'plastic-roll', 'bottle', 'plastic-chunks', 'plastic') THEN 'plastic'
    WHEN icon IN ('rebar', 'corrugated', 'pipe-fitting', 'steel-plate', 'metal') THEN 'iron-steel'
    WHEN icon IN ('copper-pipe', 'brass-pot', 'aluminium-pot', 'beam', 'gear') THEN 'non-ferrous'
    WHEN icon IN ('wire', 'wire-appliance', 'mesh', 'thick-cable') THEN 'wire'
    ELSE 'other'
  END
  WHERE category IS NULL;

CREATE TABLE IF NOT EXISTS rate_history (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES scrap_categories(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_history_category ON rate_history(category_id, recorded_at);
-- Every rate's history starts with the price it has now.
INSERT INTO rate_history (category_id, price, recorded_at)
  SELECT c.id, c.price, c.updated_at FROM scrap_categories c
  WHERE NOT EXISTS (SELECT 1 FROM rate_history h WHERE h.category_id = c.id);
-- From now on the database itself records every new price, however it's changed.
CREATE OR REPLACE FUNCTION record_rate_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO rate_history (category_id, price) VALUES (NEW.id, NEW.price);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER scrap_categories_history
  AFTER INSERT OR UPDATE OF price ON scrap_categories
  FOR EACH ROW EXECUTE FUNCTION record_rate_history();

-- Reviews come from business clients: the kind of business is shown with
-- each one. The four sample household reviews from the site's first version
-- are removed (matched exactly, so a real review is never touched).
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS company_type VARCHAR(100);
DELETE FROM testimonials WHERE company_type IS NULL AND (customer_name, area, left(message, 30)) IN (
  ('Rohit Sharma', 'Dwarka', 'Booked a pickup in the morning'),
  ('Anita Verma', 'Rohini', 'Best rates I have found for ol'),
  ('Mohd. Irfan', 'Lajpat Nagar', 'Cleared out a whole room of ol'),
  ('Priya Nanda', 'Vasant Kunj', 'Loved how easy it was to book ')
);

-- Before a truck leaves: the customer (or the admin, after a call) says the
-- scrap is ready, and the admin confirms by phone.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS ready_date DATE;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS dispatch_checked_at TIMESTAMP;

-- The secret in each quote's private link (lib/quotes.js).
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS quote_token VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_requests_quote_token ON pickup_requests(quote_token);

-- "Request a call back": a name, a number and a question. Removed along with
-- the customer's account, if they have one.
CREATE TABLE IF NOT EXISTS callback_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  query TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_callback_requests_created_at ON callback_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pickup_requests_status ON pickup_requests(status);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_created_at ON pickup_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demolition_requests_status ON demolition_requests(status);
CREATE INDEX IF NOT EXISTS idx_demolition_requests_created_at ON demolition_requests(created_at DESC);
