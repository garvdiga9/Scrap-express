const pool = require('../db/pool');

const PROFILE_COLUMNS = [
  'id', 'verified_phone', 'email', 'name', 'phone', 'company_name',
  'business_type', 'gstin', 'address', 'area', 'pincode', 'created_at',
].join(', ');

// Compare phone numbers on their last 10 digits, so "+91 98765 43210",
// "9876543210" and "+919876543210" all match.
const LAST10 = (expr) => `right(regexp_replace(${expr}, '[^0-9]', '', 'g'), 10)`;

async function findCustomer(id) {
  const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS} FROM customers WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Create the customer on first login; on later logins only refresh what the
// identity provider vouches for, never overwrite details they edited.
async function upsertFromToken(decoded) {
  const verifiedPhone = decoded.phone_number || null;
  const { rows } = await pool.query(
    `INSERT INTO customers (firebase_uid, verified_phone, email, name, phone, last_login_at)
     VALUES ($1, $2, $3, $4, $2, NOW())
     ON CONFLICT (firebase_uid) DO UPDATE SET
       verified_phone = COALESCE(EXCLUDED.verified_phone, customers.verified_phone),
       email = COALESCE(customers.email, EXCLUDED.email),
       name = COALESCE(customers.name, EXCLUDED.name),
       phone = COALESCE(customers.phone, EXCLUDED.phone),
       last_login_at = NOW()
     RETURNING id, verified_phone`,
    [decoded.uid, verifiedPhone, decoded.email || null, decoded.name || null]
  );
  return rows[0];
}

// A phone number proven by OTP is the customer's, so requests made before
// they had an account can be attached to it.
async function linkRequestsByVerifiedPhone(customerId, verifiedPhone) {
  if (!verifiedPhone) return;
  for (const table of ['pickup_requests', 'demolition_requests']) {
    await pool.query(
      `UPDATE ${table} SET customer_id = $1
       WHERE customer_id IS NULL AND ${LAST10('phone')} = ${LAST10('$2')}`,
      [customerId, verifiedPhone]
    );
  }
}

// After a booking, fill only the profile fields the customer hasn't set yet,
// so the next booking auto-fills without them visiting their account page.
async function fillBlankProfile(customerId, fields) {
  await pool.query(
    `UPDATE customers SET
       name          = COALESCE(NULLIF(name, ''), $2),
       phone         = COALESCE(NULLIF(phone, ''), $3),
       email         = COALESCE(NULLIF(email, ''), $4),
       company_name  = COALESCE(NULLIF(company_name, ''), $5),
       business_type = COALESCE(NULLIF(business_type, ''), $6),
       gstin         = COALESCE(NULLIF(gstin, ''), $7),
       address       = COALESCE(NULLIF(address, ''), $8),
       area          = COALESCE(NULLIF(area, ''), $9),
       pincode       = COALESCE(NULLIF(pincode, ''), $10)
     WHERE id = $1`,
    [
      customerId, fields.name || null, fields.phone || null, fields.email || null,
      fields.companyName || null, fields.businessType || null, fields.gstin || null,
      fields.address || null, fields.area || null, fields.pincode || null,
    ]
  );
}

async function updateProfile(customerId, p) {
  const { rows } = await pool.query(
    `UPDATE customers SET
       name = $2, phone = $3, email = $4, company_name = $5, business_type = $6,
       gstin = $7, address = $8, area = $9, pincode = $10
     WHERE id = $1
     RETURNING ${PROFILE_COLUMNS}`,
    [
      customerId, p.name, p.phone, p.email, p.companyName, p.businessType,
      p.gstin, p.address, p.area, p.pincode,
    ]
  );
  return rows[0] || null;
}

async function listRequests(customerId) {
  const { rows } = await pool.query(
    `SELECT 'pickup' AS kind, id, created_at, status, scrap_type AS detail,
            approx_quantity AS quantity, area AS location, pickup_frequency AS frequency,
            quote_items, quote_note, quoted_at, quote_response, quote_responded_at
       FROM pickup_requests WHERE customer_id = $1
     UNION ALL
     SELECT 'demolition', id, created_at, status, building_type,
            approx_area, location, NULL,
            NULL::jsonb, NULL, NULL::timestamp, NULL, NULL::timestamp
       FROM demolition_requests WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [customerId]
  );
  return rows;
}

// The customer answers a quote on their own request. Only a quote that's
// still waiting can be answered, so a stale page can't overwrite a revision.
async function respondToQuote(customerId, requestId, response) {
  const { rows } = await pool.query(
    `UPDATE pickup_requests
     SET status = $3, quote_response = $3, quote_responded_at = NOW()
     WHERE id = $1 AND customer_id = $2 AND status = 'quoted'
     RETURNING id, company_name, name`,
    [requestId, customerId, response]
  );
  return rows[0] || null;
}

module.exports = {
  findCustomer, upsertFromToken, linkRequestsByVerifiedPhone,
  fillBlankProfile, updateProfile, listRequests, respondToQuote,
};
