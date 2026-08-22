const router = require('express').Router();
const pool = require('../db/pool');

// GET /api/rates - public list of scrap categories with current buying price
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, unit, price, icon FROM scrap_categories ORDER BY sort_order ASC, name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rates' });
  }
});

module.exports = router;
