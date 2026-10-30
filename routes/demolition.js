const router = require('express').Router();
const pool = require('../db/pool');
const { PHONE_RE } = require('../lib/validation');
const media = require('../lib/media');
const push = require('../lib/push');

// POST /api/demolition - public: request a demolition site visit & quote,
// optionally with photos/videos of the building.
router.post('/', media.acceptMedia, async (req, res) => {
  const { name, phone, email, buildingType, location, approxArea, notes } = req.body;

  if (!name || !phone || !buildingType || !location) {
    return res.status(400).json({ error: 'Name, phone, building type, and location are required.' });
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  const mediaError = media.missingMediaError(req);
  if (mediaError) return res.status(400).json({ error: mediaError });

  const customerId = (req.session && req.session.customerId) || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO demolition_requests
        (name, phone, email, building_type, location, approx_area, notes, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [name, phone, email || null, buildingType, location, approxArea || null, notes || null, customerId]
    );
    await media.saveForRequest(req, 'demolition', rows[0].id)
      .catch((err) => console.error('saving demolition media failed', err));
    push.quietly(push.notifyAdmins({
      title: `New demolition request #${rows[0].id} 🏗️`,
      body: `${name} · ${buildingType} · ${String(location).slice(0, 60)}`,
      url: `/admin.html#demolition-${rows[0].id}`,
      tag: `demolition-${rows[0].id}`,
    }));
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
