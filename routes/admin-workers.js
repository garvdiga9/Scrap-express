// Admin: workers, daily attendance and month-end pay (lib/workers.js).
// Mounted at /api/admin. Managers can see the workers and mark attendance;
// wages and pay are for the owner only.
const router = require('express').Router();
const { requireAdmin, requireOwner, roleOf } = require('../middleware/auth');
const workers = require('../lib/workers');

router.use('/workers', requireAdmin);
router.use('/attendance', requireAdmin);
router.use('/payroll', requireOwner);

const guard = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
const answer = (res, { error, value }, status = 200) => {
  if (error) return res.status(error === 'Not found' ? 404 : 400).json({ error });
  return res.status(status).json(value);
};

router.get('/workers', guard(async (req, res) => {
  res.json({
    workers: await workers.list({ withWages: roleOf(req) === 'owner' }),
    departments: workers.DEPARTMENTS,
    wageTypes: workers.WAGE_TYPES,
    statuses: workers.STATUSES,
    today: workers.today(),
  });
}));
router.post('/workers', requireOwner, guard(async (req, res) => answer(res, await workers.save(null, req.body || {}), 201)));
router.put('/workers/:id', requireOwner, guard(async (req, res) => answer(res, await workers.save(Number(req.params.id), req.body || {}))));

router.get('/attendance', guard(async (req, res) => answer(res, await workers.attendanceFor(String(req.query.date || workers.today())))));
router.put('/attendance', guard(async (req, res) => {
  const by = (req.session && req.session.adminName) || 'Admin';
  answer(res, await workers.mark(String(req.body.date || ''), req.body.entries, by));
}));

router.get('/payroll', guard(async (req, res) => answer(res, await workers.payroll(String(req.query.month || workers.today().slice(0, 7))))));
router.get('/payroll.csv', requireOwner, guard(async (req, res) => {
  const { error, value } = await workers.payroll(String(req.query.month || ''));
  if (error) return res.status(400).json({ error });
  res.set('Cache-Control', 'private, no-store');
  res.attachment(`pay-${value.month}.csv`);
  res.type('text/csv').send(`\uFEFF${workers.payrollCsv(value)}`); // BOM so Excel reads ₹ correctly
}));

module.exports = router;
