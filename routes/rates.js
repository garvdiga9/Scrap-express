const router = require('express').Router();
const rates = require('../lib/rates');

// GET /api/rates - public list of scrap rates (current price, group, page
// address, photo, 30-day trend) and when they were last updated.
router.get('/', async (req, res) => {
  try {
    const [list, updated] = await Promise.all([rates.listRates(), rates.lastUpdated()]);
    res.set('X-Rates-Updated', updated ? updated.toISOString() : '');
    res.json(list.map(({ trend, ...rate }) => ({
      ...rate,
      trend: {
        direction: trend.direction, start: trend.start, change: trend.change, pct: trend.pct, label: trend.label,
      },
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rates' });
  }
});

module.exports = router;
