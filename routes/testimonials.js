const router = require('express').Router();
const { listReviews } = require('../lib/reviews');

// GET /api/testimonials - public list of client reviews
router.get('/', async (req, res) => {
  try {
    res.json(await listReviews());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

module.exports = router;
