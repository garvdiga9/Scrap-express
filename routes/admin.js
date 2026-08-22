const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const ALLOWED_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

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
  if (!ALLOWED_STATUSES.includes(status)) {
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
