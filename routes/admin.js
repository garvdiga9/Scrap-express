const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { PICKUP_STATUSES, QUOTE_UNITS } = require('../data/business');

const ALLOWED_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const MAX_QUOTE_LINES = 20;
const MAX_QUOTE_NOTE = 1000;

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
    req.session.isAdmin = true;
    req.session.username = user.username;
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

// ---- pickup requests ----

router.get('/requests', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pickup_requests ORDER BY created_at DESC');
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
    const { rows } = await pool.query(
      'UPDATE pickup_requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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
           quote_response = NULL, quote_responded_at = NULL, status = 'quoted'
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(items), note || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save the quote' });
  }
});

router.delete('/requests/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM pickup_requests WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// ---- demolition requests ----

router.get('/demolition', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM demolition_requests ORDER BY created_at DESC');
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
      'UPDATE demolition_requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

router.delete('/demolition/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM demolition_requests WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete request' });
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/rates/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM scrap_categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

router.delete('/testimonials/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM testimonials WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete testimonial' });
  }
});

module.exports = router;
