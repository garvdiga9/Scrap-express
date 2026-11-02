const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { PICKUP_STATUSES, QUOTE_UNITS, formatQuoteRate } = require('../data/business');
const media = require('../lib/media');
const push = require('../lib/push');
const { mountPushRoutes } = require('./push');
const updates = require('../lib/updates');
const live = require('../lib/live');
const quotes = require('../lib/quotes');

const ALLOWED_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const MAX_QUOTE_LINES = 20;
const MAX_QUOTE_NOTE = 1000;
const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

// ---- auth ----

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    // A fresh session ID on login (prevents session fixation).
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.isAdmin = true;
    req.session.username = user.username;
    // "Keep me signed in" on a phone; otherwise the default one-day session.
    if (req.body.remember === true) req.session.cookie.maxAge = THIRTY_DAYS;
    res.json({ message: 'Logged in', username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

router.get('/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ username: req.session.username });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// ---- notifications to the admin's phone ----

mountPushRoutes(router, requireAdmin, () => ({ admin: true }));

router.post('/push/test', requireAdmin, async (req, res) => {
  try {
    const sent = await push.notifyAdmins({
      title: 'Notifications are working 🔔',
      body: "You'll get an alert here for every new pickup or demolition request.",
      url: '/admin.html',
      tag: 'test',
    });
    res.json({ sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send a test notification.' });
  }
});

// What a customer is told when their request's status changes.
const STATUS_NOTICES = {
  pickup: {
    confirmed: (id) => ['Pickup confirmed 🚚', `Request #${id} is confirmed. Our team will call you with the pickup time.`],
    completed: (id) => ['Pickup completed ✅', `Thank you! Request #${id} is complete. Your GST invoice and weight slip will follow.`],
    cancelled: (id) => ['Request cancelled', `Pickup request #${id} was cancelled. Call us if this is unexpected.`],
  },
  demolition: {
    confirmed: (id) => ['Site visit confirmed', `Demolition request #${id} is confirmed. Our team will call you to schedule the visit.`],
    completed: (id) => ['Demolition completed ✅', `Thank you! Demolition request #${id} is complete.`],
    cancelled: (id) => ['Request cancelled', `Demolition request #${id} was cancelled. Call us if this is unexpected.`],
  },
};

function notifyStatusChange(kind, row, oldStatus) {
  const notice = STATUS_NOTICES[kind][row.status];
  if (!notice || !row.customer_id || row.status === oldStatus) return;
  const [title, body] = notice(row.id);
  push.quietly(push.notifyCustomer(row.customer_id, { title, body, url: '/account', tag: `${kind}-${row.id}` }));
}

// ---- pickup requests ----

router.get('/requests', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, ${media.mediaListSql('pickup', 'p.id')} AS media,
              (SELECT COUNT(*)::int FROM pickup_requests other
               WHERE other.id <> p.id AND other.status = 'no_scrap'
                 AND (other.customer_id = p.customer_id
                      OR right(regexp_replace(other.phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10))
              ) AS past_no_scrap
       FROM pickup_requests p ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.patch('/requests/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!PICKUP_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    // Joining the row to itself reads the status from before the update.
    const { rows } = await pool.query(
      `UPDATE pickup_requests p
       SET status = $1::varchar,
           ready_at = CASE WHEN $1::varchar = 'ready' THEN COALESCE(old.ready_at, NOW()) ELSE old.ready_at END,
           dispatch_checked_at = CASE WHEN $1::varchar = 'confirmed' THEN NOW() ELSE old.dispatch_checked_at END
       FROM pickup_requests old
       WHERE p.id = $2 AND old.id = p.id
       RETURNING p.*, old.status AS old_status`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const { old_status: oldStatus, ...row } = rows[0];
    res.json(row);
    live.requestChanged(row.customer_id, row.quote_token);
    notifyStatusChange('pickup', row, oldStatus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Send (or revise) a quote. A revised quote needs a fresh answer, so any
// earlier accept/decline is cleared.
router.put('/requests/:id/quote', requireAdmin, async (req, res) => {
  const lines = Array.isArray(req.body.items) ? req.body.items : [];
  if (!lines.length || lines.length > MAX_QUOTE_LINES) {
    return res.status(400).json({ error: `Add between 1 and ${MAX_QUOTE_LINES} quote lines.` });
  }
  const items = [];
  for (const line of lines) {
    const material = String(line?.material ?? '').trim();
    const rate = Number(line?.rate);
    if (!material || material.length > 100) {
      return res.status(400).json({ error: 'Each line needs a material name (up to 100 characters).' });
    }
    if (line.rate === '' || line.rate == null || !Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ error: `Please enter a valid rate for "${material}".` });
    }
    if (!QUOTE_UNITS.includes(line.unit)) {
      return res.status(400).json({ error: 'Please choose a unit from the list.' });
    }
    items.push({ material, rate: Math.round(rate * 100) / 100, unit: line.unit });
  }
  const note = String(req.body.note ?? '').trim();
  if (note.length > MAX_QUOTE_NOTE) {
    return res.status(400).json({ error: `Please keep the note under ${MAX_QUOTE_NOTE} characters.` });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE pickup_requests
       SET quote_items = $1, quote_note = $2, quoted_at = NOW(),
           quote_response = NULL, quote_responded_at = NULL, status = 'quoted',
           ready_at = NULL, ready_date = NULL, dispatch_checked_at = NULL,
           quote_token = COALESCE(quote_token, $4)
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(items), note || null, req.params.id, quotes.newToken()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    // The admin sees whether the email really went, so it comes before the answer.
    const emailStatus = await quotes.emailQuote(rows[0]);
    res.json({ ...rows[0], email_status: emailStatus });
    live.requestChanged(rows[0].customer_id, rows[0].quote_token);
    const lines = items.slice(0, 2).map((item) => `${item.material} ${formatQuoteRate(item)}`);
    if (items.length > 2) lines.push(`+${items.length - 2} more`);
    push.quietly(push.notifyCustomer(rows[0].customer_id, {
      title: 'Your quote is ready 💰',
      body: `Request #${rows[0].id}: ${lines.join(', ')}. Tap to accept or decline.`,
      url: '/account',
      tag: `pickup-${rows[0].id}`,
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save the quote' });
  }
});

router.delete('/requests/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM pickup_requests WHERE id = $1 RETURNING customer_id, quote_token', [req.params.id]);
    await media.removeForRequest('pickup', req.params.id);
    res.json({ message: 'Deleted' });
    live.requestChanged(rows[0] && rows[0].customer_id, rows[0] && rows[0].quote_token);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// ---- demolition requests ----

router.get('/demolition', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, ${media.mediaListSql('demolition', 'd.id')} AS media
       FROM demolition_requests d ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load demolition requests' });
  }
});

router.patch('/demolition/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE demolition_requests d SET status = $1 FROM demolition_requests old
       WHERE d.id = $2 AND old.id = d.id
       RETURNING d.*, old.status AS old_status`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const { old_status: oldStatus, ...row } = rows[0];
    res.json(row);
    live.requestChanged(row.customer_id);
    notifyStatusChange('demolition', row, oldStatus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

router.delete('/demolition/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM demolition_requests WHERE id = $1 RETURNING customer_id', [req.params.id]);
    await media.removeForRequest('demolition', req.params.id);
    res.json({ message: 'Deleted' });
    live.requestChanged(rows[0] && rows[0].customer_id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// ---- customers ----

// Everyone who has an account, and everyone who sent a request without one.
// People without an account are grouped by phone number (its last 10 digits),
// showing their latest details.
router.get('/customers', requireAdmin, async (req, res) => {
  try {
    const [accounts, guests] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.email, COALESCE(NULLIF(c.phone, ''), c.verified_phone) AS phone,
                c.company_name, c.business_type, c.gstin, c.address, c.area, c.created_at, c.last_login_at,
                (SELECT COUNT(*)::int FROM pickup_requests p WHERE p.customer_id = c.id) AS pickups,
                (SELECT COUNT(*)::int FROM demolition_requests d WHERE d.customer_id = c.id) AS demolitions,
                (SELECT COUNT(*)::int FROM pickup_requests p WHERE p.customer_id = c.id AND p.status = 'no_scrap') AS wasted_trips
         FROM customers c
         ORDER BY c.last_login_at DESC NULLS LAST, c.created_at DESC
         LIMIT 1000`
      ),
      pool.query(
        `WITH requests AS (
           SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) AS key, 'pickup' AS kind, name, phone, email,
                  company_name, business_type, gstin, address, area, status, created_at
           FROM pickup_requests WHERE customer_id IS NULL
           UNION ALL
           SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), 'demolition', name, phone, email,
                  NULL, NULL, NULL, location, NULL, status, created_at
           FROM demolition_requests WHERE customer_id IS NULL
         ),
         latest AS (
           SELECT DISTINCT ON (key) * FROM requests ORDER BY key, created_at DESC
         ),
         totals AS (
           SELECT key,
                  COUNT(*) FILTER (WHERE kind = 'pickup')::int AS pickups,
                  COUNT(*) FILTER (WHERE kind = 'demolition')::int AS demolitions,
                  COUNT(*) FILTER (WHERE status = 'no_scrap')::int AS wasted_trips,
                  MAX(email) AS any_email, MAX(company_name) AS any_company,
                  MIN(created_at) AS first_request_at, MAX(created_at) AS last_request_at
           FROM requests GROUP BY key
         )
         SELECT l.key, l.name, l.phone, COALESCE(l.email, t.any_email) AS email,
                COALESCE(l.company_name, t.any_company) AS company_name, l.business_type, l.gstin, l.address, l.area,
                t.pickups, t.demolitions, t.wasted_trips, t.first_request_at, t.last_request_at,
                EXISTS (
                  SELECT 1 FROM customers c
                  WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = l.key
                     OR right(regexp_replace(COALESCE(c.verified_phone, ''), '[^0-9]', '', 'g'), 10) = l.key
                     OR lower(c.email) = lower(COALESCE(l.email, t.any_email))
                ) AS has_account
         FROM latest l JOIN totals t ON t.key = l.key
         ORDER BY t.last_request_at DESC
         LIMIT 1000`
      ),
    ]);
    res.json({ accounts: accounts.rows, guests: guests.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

// ---- call back requests ----

const CALLBACK_STATUSES = ['pending', 'called', 'closed'];

router.get('/callbacks', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM callback_requests ORDER BY created_at DESC LIMIT 500');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load call back requests' });
  }
});

router.patch('/callbacks/:id', requireAdmin, async (req, res) => {
  if (!CALLBACK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query('UPDATE callback_requests SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
    live.publish('callbacks');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update the call back request' });
  }
});

router.delete('/callbacks/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM callback_requests WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
    live.publish('callbacks');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete the call back request' });
  }
});

// ---- customer photos & videos ----

// GET /api/admin/media/:id — stream one attachment (supports seeking in
// videos). ?download=1 saves it instead of opening it.
router.get('/media/:id', requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  try {
    const file = await media.findById(req.params.id);
    if (!file) return res.status(404).json({ error: 'Not found' });
    // Headers must be plain ASCII; the real (possibly Hindi) name goes in filename*.
    const name = file.original_name || file.file_name;
    const asciiName = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.sendFile(media.filePath(file), {
      headers: {
        'Content-Type': file.mime_type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File is missing' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the file' });
  }
});

// ---- daily rates & news subscribers ----

const sendError = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: fallback });
};

router.get('/subscribers', requireAdmin, async (req, res) => {
  try {
    const [counts, subscribers, settings] = await Promise.all([updates.counts(), updates.list(), updates.getSettings()]);
    res.json({ counts, subscribers, settings, channels: updates.channels() });
  } catch (err) {
    sendError(res, err, 'Failed to load subscribers');
  }
});

router.delete('/subscribers/:id', requireAdmin, async (req, res) => {
  try {
    await updates.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to remove subscriber');
  }
});

router.put('/subscribers/settings', requireAdmin, async (req, res) => {
  try {
    res.json(await updates.saveSettings(req.body));
  } catch (err) {
    sendError(res, err, 'Failed to save settings');
  }
});

router.post('/subscribers/send-rates', requireAdmin, async (req, res) => {
  try {
    res.json(await updates.sendRates());
  } catch (err) {
    sendError(res, err, 'Failed to send the rates');
  }
});

router.post('/subscribers/announce', requireAdmin, async (req, res) => {
  try {
    res.json(await updates.sendAnnouncement(req.body));
  } catch (err) {
    sendError(res, err, 'Failed to send the announcement');
  }
});

// ---- scrap rates ----

router.get('/rates', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM scrap_categories ORDER BY sort_order ASC, name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rates' });
  }
});

router.post('/rates', requireAdmin, async (req, res) => {
  const { name, unit, price, icon } = req.body;
  if (!name || price == null || Number.isNaN(Number(price))) {
    return res.status(400).json({ error: 'Name and a valid price are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO scrap_categories (name, unit, price, icon) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, unit || 'kg', price, icon || 'default']
    );
    res.status(201).json(rows[0]);
    live.publish('rates');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add category (name may already exist)' });
  }
});

router.put('/rates/:id', requireAdmin, async (req, res) => {
  const { name, unit, price, icon } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE scrap_categories
       SET name = COALESCE($1, name),
           unit = COALESCE($2, unit),
           price = COALESCE($3, price),
           icon = COALESCE($4, icon),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, unit, price, icon, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
    live.publish('rates');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/rates/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM scrap_categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
    live.publish('rates');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ---- testimonials ----

router.post('/testimonials', requireAdmin, async (req, res) => {
  const { customerName, area, rating, message } = req.body;
  if (!customerName || !message) {
    return res.status(400).json({ error: 'Name and message required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO testimonials (customer_name, area, rating, message) VALUES ($1,$2,$3,$4) RETURNING *`,
      [customerName, area || null, rating || 5, message]
    );
    res.status(201).json(rows[0]);
    live.publish('reviews');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

router.delete('/testimonials/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM testimonials WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
    live.publish('reviews');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete testimonial' });
  }
});

module.exports = router;
