const router = require('express').Router();
const firebase = require('../lib/firebase');
const customers = require('../lib/customers');
const { AREAS, BUSINESS_TYPES } = require('../data/business');
const { PHONE_RE, GSTIN_RE, PINCODE_RE, EMAIL_RE, GSTIN_ERROR } = require('../lib/validation');
const push = require('../lib/push');
const { mountPushRoutes } = require('./push');

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
    address: clean(req.body.address, 500),
    area: clean(req.body.area, 100),
    pincode: clean(req.body.pincode, 10),
  };

  if (p.phone && !PHONE_RE.test(p.phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (p.email && !EMAIL_RE.test(p.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (p.gstin && !GSTIN_RE.test(p.gstin)) return res.status(400).json({ error: GSTIN_ERROR });
  if (p.pincode && !PINCODE_RE.test(p.pincode)) return res.status(400).json({ error: 'Pincode should be 6 digits.' });
  if (p.businessType && !BUSINESS_TYPES.includes(p.businessType)) return res.status(400).json({ error: 'Please choose a business type from the list.' });
  if (p.area && p.area !== 'Other Delhi NCR' && !AREAS.includes(p.area)) return res.status(400).json({ error: 'Please choose an area from the list.' });

  try {
    const customer = await customers.updateProfile(req.session.customerId, p);
    if (!customer) return res.status(401).json({ error: 'Please log in first.' });
    res.json(customer);
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
    push.quietly(push.notifyAdmins({
      title: response === 'accepted' ? `Quote accepted ✅ #${updated.id}` : `Quote declined #${updated.id}`,
      body: response === 'accepted'
        ? `${updated.company_name || updated.name} accepted your quote. Call them to schedule the pickup.`
        : `${updated.company_name || updated.name} declined your quote.`,
      url: `/admin.html#pickup-${updated.id}`,
      tag: `pickup-${updated.id}`,
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your answer. Please try again.' });
  }
});

module.exports = router;
