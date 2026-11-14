// Shared helpers for the tests. tests/run.js starts the site on its own port
// and sets TEST_BASE_URL; every test talks to it over HTTP like a browser,
// and uses the database directly only to set up and clean up.
// Test data always uses names starting with "Test " or usernames starting
// with "test", so cleanUp() can remove it.
const crypto = require('crypto');
const pool = require('../db/pool');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN = { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'changeme123' };

// A tiny valid JPEG (the server checks the file really is an image).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);

const token = () => crypto.randomBytes(24).toString('hex');
const indiaDay = (plusDays = 0) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
};

// The session cookie from a login reply. The reply is read in full first:
// the session is saved as the reply finishes.
async function sessionCookie(res) {
  await res.text();
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid')) || '';
}

// A client that keeps one cookie: client.get(url), client.post(url, body)...
function client(cookie = '') {
  const send = async (method, url, body) => {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + url, {
      method,
      headers: { ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (err) { data = {}; }
    return { status: res.status, data, text };
  };
  return {
    cookie,
    get: (url) => send('GET', url),
    post: (url, body = {}) => send('POST', url, body),
    put: (url, body = {}) => send('PUT', url, body),
    patch: (url, body = {}) => send('PATCH', url, body),
    del: (url, body) => send('DELETE', url, body),
    page: async (url) => (await fetch(BASE + url, { headers: cookie ? { Cookie: cookie } : {} })).text(),
  };
}

async function login(path, username, password) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) return { status: res.status };
  return client(await sessionCookie(res));
}
const adminLogin = () => login('/api/admin/login', ADMIN.username, ADMIN.password);
const staffLogin = (username, password) => login('/api/staff/login', username, password);

// A customer account signed in, as Google sign-in would leave it.
async function customerLogin(name = 'Test Customer') {
  const signature = require('cookie-signature');
  const { rows: [c] } = await pool.query(
    "INSERT INTO customers (firebase_uid, name, phone, company_name) VALUES ($1, $2, '9811122233', 'Test Customer Co') RETURNING id",
    [`test-${token().slice(0, 12)}`, name]
  );
  const sid = crypto.randomBytes(18).toString('hex');
  await pool.query("INSERT INTO session (sid, sess, expire) VALUES ($1, $2, NOW() + interval '1 day')",
    [sid, { cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/' }, customerId: c.id }]);
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  return { id: c.id, ...client(`connect.sid=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`) };
}

// A pickup request already quoted (or at another status), straight in the database.
async function makeRequest({
  company = 'Test Co', status = 'quoted', mode = 'pickup', customerId = null,
  items = [{ material: 'Iron', rate: 30, unit: 'per kg' }, { material: 'Copper', rate: 600, unit: 'per kg' }],
} = {}) {
  const t = token();
  const { rows: [r] } = await pool.query(
    `INSERT INTO pickup_requests (company_name, name, phone, address, area, pincode, latitude, longitude, scrap_type, approx_quantity,
       status, quote_token, quote_items, quoted_at, quote_response, quote_responded_at, delivery_mode, office_handled, customer_id)
     VALUES ($1, 'Test Person', '9811122233', 'Plot 1, Okhla Phase 2', 'Okhla Industrial Area', '110020', 28.5355, 77.2732, 'Iron, Copper', '500 kg',
       $2::varchar, $3, $4, NOW(), CASE WHEN $2::varchar IN ('quoted', 'pending') THEN NULL ELSE 'accepted' END, CASE WHEN $2::varchar IN ('quoted', 'pending') THEN NULL ELSE NOW() END, $5, $6, $7)
     RETURNING id`,
    [company, status, t, JSON.stringify(items), mode, mode === 'self', customerId]
  );
  return { id: r.id, token: t };
}

// Two pickup times tomorrow, offered by the admin.
const twoSlots = () => [{ date: indiaDay(1), from: '10:00', to: '13:00' }, { date: indiaDay(1), from: '14:00', to: '17:00' }];

// Removes everything the tests created.
async function cleanUp() {
  const { rows } = await pool.query("SELECT id FROM pickup_requests WHERE company_name LIKE 'Test %'");
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await pool.query("DELETE FROM request_documents WHERE request_type = 'pickup' AND request_id = ANY($1)", [ids]);
    await pool.query("DELETE FROM request_events WHERE request_type = 'pickup' AND request_id = ANY($1)", [ids]);
    await pool.query("DELETE FROM request_media WHERE request_type = 'pickup' AND request_id = ANY($1)", [ids]);
    await pool.query('UPDATE pickup_requests SET slot_id = NULL, review_id = NULL WHERE id = ANY($1)', [ids]);
    await pool.query('DELETE FROM pickup_slots WHERE request_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM pickup_requests WHERE id = ANY($1)', [ids]);
  }
  await pool.query("DELETE FROM testimonials WHERE customer_name LIKE 'Test %'");
  await pool.query("DELETE FROM pickup_leads WHERE company_name LIKE 'Test %'");
  await pool.query("DELETE FROM staff_cash WHERE staff_id IN (SELECT id FROM staff_users WHERE username LIKE 'test%')");
  await pool.query("DELETE FROM staff_users WHERE username LIKE 'test%'");
  await pool.query("DELETE FROM admin_users WHERE username LIKE 'test%' AND role = 'manager'");
  await pool.query("DELETE FROM customers WHERE firebase_uid LIKE 'test-%'");
  await pool.query("DELETE FROM admin_activity WHERE admin_name LIKE 'Test %'");
}

module.exports = {
  BASE, ADMIN, JPEG, pool, token, indiaDay, client, adminLogin, staffLogin, customerLogin, makeRequest, twoSlots, cleanUp,
};
