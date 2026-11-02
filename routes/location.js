// Address helpers for the request forms. Mounted at /api/location.
const router = require('express').Router();
const { PINCODE_RE } = require('../lib/validation');
const location = require('../lib/location');

// Each lookup uses a free public service, so cap what one connection can ask for.
const LOOKUPS_PER_HOUR = 60;
const recent = new Map();
function tooMany(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recent.get(ip) || []).filter((t) => t > hourAgo);
  if (times.length >= LOOKUPS_PER_HOUR) return true;
  times.push(Date.now());
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return false;
}

const UNAVAILABLE = { error: 'Address lookup is not available right now. Please type the address.' };

// GET /api/location/pincode/110020 → { found, city, state }
router.get('/pincode/:pincode', async (req, res) => {
  if (!PINCODE_RE.test(req.params.pincode)) return res.json({ found: false });
  if (tooMany(req.ip)) return res.status(429).json(UNAVAILABLE);
  try {
    res.json(await location.lookupPincode(req.params.pincode));
  } catch (err) {
    console.error('pincode lookup failed:', err.message);
    res.status(503).json(UNAVAILABLE);
  }
});

// GET /api/location/reverse?latitude=28.53&longitude=77.27 → { street, city, state, pincode }
router.get('/reverse', async (req, res) => {
  const { latitude, longitude } = location.parseCoordinates(req.query);
  if (latitude === null) return res.status(400).json({ error: 'That location looks like it is outside India. Please type the address.' });
  if (tooMany(req.ip)) return res.status(429).json(UNAVAILABLE);
  try {
    res.json(await location.reverseGeocode(latitude, longitude));
  } catch (err) {
    console.error('address lookup failed:', err.message);
    res.status(503).json(UNAVAILABLE);
  }
});

module.exports = router;
