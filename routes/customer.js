const router = require('express').Router();
const firebase = require('../lib/firebase');
const customers = require('../lib/customers');
const { BUSINESS_TYPES, parseArea } = require('../data/business');
const quotes = require('../lib/quotes');
const { parseSite } = require('../lib/location');
const {
  GSTIN_RE, GSTIN_ERROR, PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanEmail,
} = require('../lib/validation');
const { mountPushRoutes } = require('./push');
const live = require('../lib/live');
const documents = require('../lib/documents');
const schedules = require('../lib/schedules');
const dispatch = require('../lib/dispatch');
const notify = require('../lib/notify');
const ratings = require('../lib/ratings');
const pool = require('../db/pool');

const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

function requireCustomer(req, res, next) {
  if (req.session && req.session.customerId) return next();
  return res.status(401).json({ error: 'Please log in first.' });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

// POST /api/customer/session — exchange a Firebase ID token (from Google or
// phone-OTP sign-in in the browser) for our own 30-day login session.
router.post('/session', async (req, res) => {
  if (!firebase.enabled) {
    return res.status(503).json({ error: 'Customer login is not available yet.' });
  }
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'Missing sign-in token.' });
  }

  let decoded;
  try {
    decoded = await firebase.verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Sign-in could not be verified. Please try again.' });
  }

  try {
    const customer = await customers.upsertFromToken(decoded);
    await customers.linkRequestsByVerifiedPhone(customer.id, customer.verified_phone);
    // New session ID on login (prevents session fixation). This also ends any
    // admin login in the same browser, which is the safer side to err on.
    await regenerateSession(req);
    req.session.customerId = customer.id;
    req.session.cookie.maxAge = THIRTY_DAYS;
    res.json({ ok: true });
    live.publish('customers');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not sign you in. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireCustomer, async (req, res) => {
  try {
    const customer = await customers.findCustomer(req.session.customerId);
    if (!customer) return res.status(401).json({ error: 'Please log in first.' });
    res.json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your details.' });
  }
});

router.put('/me', requireCustomer, async (req, res) => {
  const clean = (v, max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  const p = {
    name: clean(req.body.name, 150),
    phone: clean(req.body.phone, 20),
    email: clean(req.body.email, 200),
    companyName: clean(req.body.companyName, 200),
    businessType: clean(req.body.businessType, 100),
    gstin: clean(req.body.gstin, 15)?.toUpperCase() ?? null,
  };
  const chosenArea = parseArea(req.body.area, req.body.otherArea, { required: false });
  if (chosenArea.error) return res.status(400).json({ error: chosenArea.error });
  p.area = chosenArea.area;
  const site = parseSite(req.body, { required: false });
  if (site.error) return res.status(400).json({ error: site.error });
  ['address', 'building', 'street', 'landmark', 'city', 'state', 'pincode'].forEach((field) => {
    p[field] = site[field] || null;
  });

  if (p.phone) {
    p.phone = cleanPhone(p.phone);
    if (!p.phone) return res.status(400).json({ error: PHONE_ERROR });
  }
  if (p.email) {
    p.email = cleanEmail(p.email);
    if (!p.email) return res.status(400).json({ error: EMAIL_ERROR });
  }
  if (p.gstin && !GSTIN_RE.test(p.gstin)) return res.status(400).json({ error: GSTIN_ERROR });
  if (p.businessType && !BUSINESS_TYPES.includes(p.businessType)) return res.status(400).json({ error: 'Please choose a business type from the list.' });

  try {
    const customer = await customers.updateProfile(req.session.customerId, p);
    if (!customer) return res.status(401).json({ error: 'Please log in first.' });
    res.json(customer);
    live.publishToCustomer(customer.id);
    live.publish('customers');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your details.' });
  }
});

router.get('/requests', requireCustomer, async (req, res) => {
  try {
    res.json(await customers.listRequests(req.session.customerId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your requests.' });
  }
});

mountPushRoutes(router, requireCustomer, (req) => ({ customerId: req.session.customerId }));

// POST /api/customer/delete { idToken } — permanently delete the account.
// A fresh sign-in token is required, proving the person deleting it is the
// account owner right now (not just someone holding an unlocked phone's session).
const FRESH_SIGN_IN_SECONDS = 10 * 60;
router.post('/delete', requireCustomer, async (req, res) => {
  let decoded;
  try {
    decoded = await firebase.verifyIdToken(String(req.body.idToken || ''));
  } catch (err) {
    return res.status(401).json({ error: 'Please confirm by signing in again.' });
  }
  try {
    const uid = await customers.getFirebaseUid(req.session.customerId);
    if (!uid || uid !== decoded.uid) {
      return res.status(403).json({ error: 'Please sign in with the same Google account you use for Scrap Express.' });
    }
    if (Date.now() / 1000 - decoded.auth_time > FRESH_SIGN_IN_SECONDS) {
      return res.status(401).json({ error: 'Please confirm by signing in again.' });
    }
    await customers.deleteAccount(req.session.customerId);
    live.requestChanged(req.session.customerId);
    live.publish('customers');
    req.session.destroy(() => res.json({ ok: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete your account. Please try again or contact us.' });
  }
});

// POST /api/customer/requests/:id/quote — accept or decline a quote.
router.post('/requests/:id/quote', requireCustomer, async (req, res) => {
  const response = { accept: 'accepted', decline: 'declined' }[req.body.response];
  if (!response) return res.status(400).json({ error: 'Please choose accept or decline.' });
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' });
  try {
    const updated = await customers.respondToQuote(req.session.customerId, Number(req.params.id), response);
    if (!updated) {
      return res.status(409).json({ error: 'This quote can no longer be answered. Please refresh the page.' });
    }
    res.json({ ok: true, status: response });
    live.requestChanged(req.session.customerId, updated.quote_token);
    quotes.notifyAnswer(updated, response);
    if (response === 'accepted') notify.quietly('drop_info', updated.id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your answer. Please try again.' });
  }
});

// POST /api/customer/requests/:id/ready { readyDate } — "My scrap is ready".
router.post('/requests/:id/ready', requireCustomer, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' });
  const { readyDate } = req.body;
  if (!quotes.validReadyDate(readyDate)) return res.status(400).json({ error: 'Please choose a date in the next 30 days.' });
  try {
    const updated = await customers.markReady(req.session.customerId, Number(req.params.id), readyDate);
    if (!updated) return res.status(409).json({ error: 'This request has already moved on. Please refresh the page.' });
    res.json({ ok: true });
    live.requestChanged(req.session.customerId, updated.quote_token);
    quotes.notifyReady(updated, readyDate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// GET /api/customer/documents/:id — a weighbridge slip or invoice on one of
// this customer's own requests.
router.get('/documents/:id', requireCustomer, async (req, res) => {
  try {
    const doc = await documents.find(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const table = doc.request_type === 'pickup' ? 'pickup_requests' : 'demolition_requests';
    const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND customer_id = $2`, [doc.request_id, req.session.customerId]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    documents.send(res, doc, { inline: req.query.view === '1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not download the file.' });
  }
});

// POST /api/customer/requests/:id/slot { slotId } — pick one of the offered pickup slots.
router.post('/requests/:id/slot', requireCustomer, async (req, res) => {
  try {
    const row = await dispatch.chooseSlot(Number(req.params.id), { customerId: req.session.customerId }, Number(req.body.slotId));
    if (row.error) return res.status(409).json({ error: row.error });
    res.json({ ok: true });
    dispatch.announceChosen(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// A drop-off: "I've sent my scrap" { note }.
router.post('/requests/:id/sent', requireCustomer, async (req, res) => {
  try {
    const row = await dispatch.customerSent(Number(req.params.id), { customerId: req.session.customerId }, req.body.note);
    if (row.error) return res.status(409).json({ error: row.error });
    res.json({ ok: true });
    dispatch.announceSent(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// Changing a booked pickup, or cancelling, before our team sets off.
router.post('/requests/:id/reschedule', requireCustomer, async (req, res) => {
  try {
    
    const result = req.body.newSlots
      ? await dispatch.askNewSlots(Number(req.params.id), { customerId: req.session.customerId })
      : await dispatch.changeSlot(Number(req.params.id), { customerId: req.session.customerId }, Number(req.body.slotId));
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
    dispatch.announceChange(req.body.newSlots ? 'new_slots' : 'moved', result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

router.post('/requests/:id/cancel', requireCustomer, async (req, res) => {
  try {
    
    const result = await dispatch.cancelByCustomer(Number(req.params.id), { customerId: req.session.customerId }, req.body.reason);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
    dispatch.announceChange('cancelled', result, result.cancel_reason);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// Rating a finished pickup.
router.post('/requests/:id/rating', requireCustomer, async (req, res) => {
  try {
    
    const result = await ratings.rate(Number(req.params.id), { customerId: req.session.customerId }, req.body || {});
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// ---- repeat pickups ----

router.post('/schedules', requireCustomer, async (req, res) => {
  try {
    const { schedule, error } = await schedules.createSchedule(req.session.customerId, {
      sourceRequestId: Number(req.body.sourceRequestId),
      frequency: req.body.frequency,
      startDate: req.body.startDate,
      acceptTerms: Boolean(req.body.acceptTerms),
    });
    if (error) return res.status(400).json({ error });
    res.status(201).json(schedule);
    live.publishToCustomer(req.session.customerId);
    // A pickup due within two days is created straight away.
    schedules.runDue().catch((err) => console.error(err));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not set up the repeat pickup.' });
  }
});

router.patch('/schedules/:id', requireCustomer, async (req, res) => {
  try {
    const schedule = await schedules.setActive(req.session.customerId, Number(req.params.id), Boolean(req.body.active));
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
    live.publishToCustomer(req.session.customerId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not change the repeat pickup.' });
  }
});

router.delete('/schedules/:id', requireCustomer, async (req, res) => {
  try {
    if (!(await schedules.remove(req.session.customerId, Number(req.params.id)))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    live.publishToCustomer(req.session.customerId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the repeat pickup.' });
  }
});

module.exports = router;
