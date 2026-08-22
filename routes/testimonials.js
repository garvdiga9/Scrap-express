const router = require('express').Router();
const pool = require('../db/pool');

// GET /api/testimonials - public list of customer reviews
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, customer_name, area, rating, message FROM testimonials ORDER BY created_at DESC LIMIT 20'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

module.exports = router;
