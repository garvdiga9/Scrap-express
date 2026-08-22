const router = require('express').Router();
const pool = require('../db/pool');

const PHONE_RE = /^[0-9+\-\s]{7,15}$/;

// POST /api/pickup - public: customer submits a scrap pickup request
router.post('/', async (req, res) => {
  const {
    name, phone, email, address, area, pincode,
    scrapType, quantity, preferredDate, notes,
  } = req.body;

  if (!name || !phone || !address || !scrapType) {
    return res.status(400).json({ error: 'Name, phone, address, and scrap type are required.' });
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO pickup_requests
        (name, phone, email, address, area, pincode, scrap_type, approx_quantity, preferred_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        name, phone, email || null, address, area || null, pincode || null,
        scrapType, quantity || null, preferredDate || null, notes || null,
      ]
    );
    res.status(201).json({
      id: rows[0].id,
      message: 'Pickup request received! Our team will call you shortly to confirm the time.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again or call us directly.' });
  }
});

module.exports = router;
