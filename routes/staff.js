// The staff app (public/staff.html): staff sign in with the username and
// password the owner gave them, see pickups, claim one, and mark each step.
// Mounted at /api/staff.
const router = require('express').Router();
const dispatch = require('../lib/dispatch');
const documents = require('../lib/documents');
const loginLimit = require('../lib/login-limit');
const { mountPushRoutes } = require('./push');

const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

// Signed in, and still an active staff member (the owner may have switched
// the account off since).
async function requireStaff(req, res, next) {
  const id = req.session && req.session.staffId;
  if (!id) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const staff = await dispatch.findStaff(id);
    if (!staff) {
      delete req.session.staffId;
      return res.status(401).json({ error: 'This account is switched off. Please ask the owner.' });
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Please enter your username and password.' });
  }
  // The same slowing-down of password guessing as the admin login.
  const wait = loginLimit.retryAfter(req.ip, `staff:${username}`);
  if (wait) {
    const minutes = Math.ceil(wait / 60);
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Too many wrong attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }
  try {
    const staff = await dispatch.checkStaffLogin(username, password);
    if (!staff) {
      loginLimit.recordFailure(req.ip, `staff:${username}`);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    loginLimit.recordSuccess(req.ip);
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.staffId = staff.id;
    req.session.cookie.maxAge = THIRTY_DAYS; // staff stay signed in on their phone
    res.json({ name: staff.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not sign you in. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireStaff, (req, res) => res.json({ name: req.staff.name }));

mountPushRoutes(router, requireStaff, (req) => ({ staffId: req.staff.id }));

router.get('/pickups', requireStaff, async (req, res) => {
  try {
    res.json(await dispatch.listForStaff(req.staff.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the pickups.' });
  }
});

// Each action answers 409 when the pickup has moved on (someone else took it,
// the owner reassigned it, or the step was already done).
const MOVED_ON = 'This pickup has changed. The list has been refreshed.';
function action(run, after) {
  return async (req, res) => {
    try {
      const row = await run(req);
      if (!row) return res.status(409).json({ error: MOVED_ON });
      res.json({ ok: true, status: row.status });
      after(row, req);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save that. Please try again.' });
    }
  };
}

router.post('/pickups/:id/claim', requireStaff, action(
  (req) => dispatch.claim(req.staff.id, Number(req.params.id)),
  (row) => dispatch.requestChanged(row)
));

router.post('/pickups/:id/release', requireStaff, action(
  (req) => dispatch.release(req.staff.id, Number(req.params.id)),
  (row) => dispatch.requestChanged(row)
));

// { step: 'on_way' | 'arrived' }
router.post('/pickups/:id/step', requireStaff, action(
  (req) => dispatch.step(req.staff.id, Number(req.params.id), req.body.step),
  (row) => dispatch.announceStep(row)
));

// Photo of the weighing machine (field "file") + the weight in kg.
router.post('/pickups/:id/weigh', requireStaff, documents.acceptDocument, async (req, res) => {
  const kg = Number(req.body.kg);
  const fail = async (status, error) => {
    await documents.removeFiles([req.document.fileName]);
    res.status(status).json({ error });
  };
  if (!req.document.mime.startsWith('image/')) return fail(400, 'Please take a photo of the weighing machine.');
  if (!Number.isFinite(kg) || kg <= 0 || kg > 1000000) return fail(400, 'Please enter the weight in kg.');
  try {
    const row = await dispatch.weigh(req.staff.id, Number(req.params.id), kg, req.document);
    if (!row) return fail(409, MOVED_ON);
    res.json({ ok: true, status: row.status });
    dispatch.announceStep(row);
  } catch (err) {
    console.error(err);
    await fail(500, 'Could not save the weight. Please try again.');
  }
});

// { method: 'cash' | 'bank' }
router.post('/pickups/:id/paid', requireStaff, action(
  (req) => dispatch.paid(req.staff.id, Number(req.params.id), req.body.method),
  (row) => dispatch.announceStep(row)
));

router.post('/pickups/:id/no-scrap', requireStaff, action(
  (req) => dispatch.noScrap(req.staff.id, Number(req.params.id)),
  (row) => dispatch.announceStep(row)
));

module.exports = router;
