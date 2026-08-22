const router = require('express').Router();
const pool = require('../db/pool');

const PHONE_RE = /^[0-9+\-\s]{7,15}$/;

// POST /api/demolition - public: request a demolition site visit & quote
router.post('/', async (req, res) => {
  const { name, phone, email, buildingType, location, approxArea, notes } = req.body;

  if (!name || !phone || !buildingType || !location) {
    return res.status(400).json({ error: 'Name, phone, building type, and location are required.' });
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO demolition_requests
        (name, phone, email, building_type, location, approx_area, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [name, phone, email || null, buildingType, location, approxArea || null, notes || null]
    );
    res.status(201).json({
      id: rows[0].id,
      message: 'Request received! Our site survey team will call you shortly to schedule a visit.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

module.exports = router;
