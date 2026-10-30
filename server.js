require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const {
  AREAS, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, formatQuoteRate,
} = require('./data/business');
const ratesRouter = require('./routes/rates');
const pickupRouter = require('./routes/pickup');
const demolitionRouter = require('./routes/demolition');
const testimonialsRouter = require('./routes/testimonials');
const adminRouter = require('./routes/admin');
const customerRouter = require('./routes/customer');
const firebase = require('./lib/firebase');
const media = require('./lib/media');
const push = require('./lib/push');
const updates = require('./lib/updates');
const subscribeRouter = require('./routes/subscribe');
const customers = require('./lib/customers');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json());

// One line per API call, so a request that stalls or gets dropped shows up in
// the server log (locally and in Render's Logs tab).
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  res.on('close', () => {
    if (!res.writableFinished) {
      console.log(`${req.method} ${req.originalUrl} -> client gave up after ${Date.now() - start}ms, no response sent`);
    }
  });
  next();
});

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  },
}));

// Digital Asset Links: proves to Android that the Play Store app and this
// website belong together, so the app opens full-screen without a browser bar.
// The fingerprint comes from the app's signing key (Play Console → App
// integrity); several can be given, comma-separated.
app.get('/.well-known/assetlinks.json', (req, res) => {
  const fingerprints = String(process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '')
    .split(',').map((f) => f.trim().toUpperCase()).filter(Boolean);
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.scrapexpress.app';
  res.json(fingerprints.length ? [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }] : []);
});

// Public key browsers need to subscribe to push notifications.
app.get('/api/push/key', async (req, res) => {
  try {
    res.json({ publicKey: await push.getPublicKey() });
  } catch (err) {
    res.status(503).json({ error: 'Notifications are not available right now.' });
  }
});

app.use('/api/subscribe', express.urlencoded({ extended: false }), subscribeRouter);
app.use('/api/rates', ratesRouter);
app.use('/api/pickup', pickupRouter);
app.use('/api/demolition', demolitionRouter);
app.use('/api/testimonials', testimonialsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/customer', customerRouter);

app.use(express.static(path.join(__dirname, 'public')));

// Pages (not static files or the API) know who's logged in, so the header can
// show "My Account" and the booking form can auto-fill.
app.use(async (req, res, next) => {
  res.locals.customer = null;
  res.locals.loginEnabled = firebase.enabled;
  // For the "daily rates" sign-up box in the footer (cached, see lib/settings).
  res.locals.whatsappChannelUrl = await updates.getSettings()
    .then((s) => s.whatsappChannelUrl).catch(() => '');
  const id = req.session && req.session.customerId;
  if (!id) return next();
  try {
    res.locals.customer = await customers.findCustomer(id);
    if (!res.locals.customer) delete req.session.customerId;
    // Pages carrying someone's details shouldn't linger in a shared browser's cache.
    else res.set('Cache-Control', 'no-store');
  } catch (err) {
    console.error(err);
  }
  next();
});

// ---- page routes ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.areas = AREAS;
app.locals.businessTypes = BUSINESS_TYPES;
app.locals.scrapTypes = SCRAP_TYPES;
app.locals.pickupFrequencies = PICKUP_FREQUENCIES;
app.locals.minPickupKg = MIN_PICKUP_KG;
app.locals.mediaLimits = media.LIMITS;
app.locals.statusLabels = {
  pending: 'Received', quoted: 'Quote Ready', accepted: 'Quote Accepted', declined: 'Quote Declined',
  confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
};
app.locals.formatQuoteRate = formatQuoteRate;

const PAGES = [
  { path: '/', view: 'index', page: 'home', title: 'Scrap Express - Bulk Scrap Buyers for Businesses in Delhi NCR', description: 'Scrap Express buys scrap in bulk from factories, offices, hospitals, schools, malls, hotels and restaurant chains across Delhi NCR. GST invoice, weighbridge slips and bank transfer payment.' },
  { path: '/rates', view: 'rates', page: 'rates', title: 'Indicative Scrap Rates in Delhi - Scrap Express', description: 'Indicative per-kg scrap rates in Delhi for paper, plastic, iron, copper, brass, aluminium, wires and more. Request a bulk quote for business volumes.' },
  { path: '/what-we-buy', view: 'what-we-buy', page: 'what-we-buy', title: 'What We Buy - Industrial & Office Scrap - Scrap Express', description: 'We buy AC plants, generators, motors, IT equipment, office furniture, glass and more from businesses across Delhi NCR. Quotes based on volume and condition.' },
  { path: '/book-pickup', view: 'book-pickup', page: 'book-pickup', title: 'Request a Bulk Scrap Pickup in Delhi NCR - Scrap Express', description: 'Request a one-time or scheduled bulk scrap pickup from your factory, office or site in Delhi NCR. GST invoice, weighbridge slip, payment by bank transfer.' },
  { path: '/demolition', view: 'demolition', page: 'demolition', title: 'Commercial Demolition Services in Delhi NCR - Scrap Express', description: 'Demolition of schools, hospitals, factories, warehouses, malls and commercial buildings across Delhi NCR, with site survey and detailed quote.' },
  { path: '/privacy', view: 'privacy', page: 'privacy', title: 'Privacy Policy - Scrap Express', description: 'How Scrap Express collects, uses and protects information from customers of our website and app.' },
  { path: '/delete-account', view: 'delete-account', page: 'delete-account', title: 'Delete Your Account - Scrap Express', description: 'How to delete your Scrap Express account and what happens to your data.' },
  { path: '/areas', view: 'areas', page: 'areas', title: 'Industrial Areas We Serve in Delhi NCR - Scrap Express', description: 'Scrap Express collects bulk scrap from businesses in Okhla, Naraina, Mayapuri, Wazirpur, Bawana, Noida, Gurugram, Manesar, Faridabad and across Delhi NCR.' },
];

PAGES.forEach(({ path: routePath, view, page, title, description }) => {
  app.get(routePath, (req, res) => res.render(view, { page, title, description }));
});

// Only same-site paths, so ?next= can't send people to another website.
const safeNext = (value) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/account');

app.get('/login', (req, res) => {
  const next = safeNext(req.query.next);
  if (res.locals.customer) return res.redirect(next);
  res.render('login', {
    page: 'login',
    title: 'Customer Login - Scrap Express',
    description: 'Log in to track your scrap pickup requests and book faster.',
    noindex: true,
    next,
    firebaseConfig: firebase.clientConfig,
    phoneLoginEnabled: firebase.phoneEnabled,
  });
});

// ---- daily rates subscription pages (links in emails) ----
const NOTICE = { page: 'notice', noindex: true, description: 'Scrap Express daily rates and news.' };

app.get('/subscribe/confirm', async (req, res) => {
  const confirmed = await updates.confirm(req.query.token).catch(() => null);
  res.render('notice', confirmed
    ? { ...NOTICE, title: 'Subscribed - Scrap Express', heading: "You're subscribed! 🎉", message: `We'll email today's scrap rates to ${confirmed.email} every morning, plus news about anything new we launch.` }
    : { ...NOTICE, title: 'Link expired - Scrap Express', icon: 'icon-close', heading: 'This link has expired', message: 'This confirmation link is no longer valid. You can subscribe again from the bottom of any page.' });
});

// A page with a button, rather than unsubscribing on the GET itself, because
// email scanners open links automatically.
app.get('/unsubscribe', async (req, res) => {
  if (req.query.done) {
    return res.render('notice', { ...NOTICE, title: 'Unsubscribed - Scrap Express', heading: "You've been unsubscribed", message: "You won't get any more rate updates from us. You can subscribe again any time." });
  }
  const sub = await updates.findByToken(req.query.token).catch(() => null);
  if (!sub) {
    return res.render('notice', { ...NOTICE, title: 'Unsubscribe - Scrap Express', heading: 'Already unsubscribed', message: "This subscription isn't active any more, so you won't get further updates." });
  }
  res.render('notice', {
    ...NOTICE, title: 'Unsubscribe - Scrap Express', icon: 'icon-mail',
    heading: 'Stop rate updates?',
    message: `${sub.email || sub.phone} will no longer get daily scrap rates and news from Scrap Express.`,
    form: { action: `/api/subscribe/unsubscribe?token=${encodeURIComponent(req.query.token)}`, button: 'Unsubscribe' },
  });
});

app.get('/account', async (req, res) => {
  if (!res.locals.customer) return res.redirect('/login?next=/account');
  try {
    const requests = await customers.listRequests(res.locals.customer.id);
    res.render('account', {
      page: 'account',
      title: 'My Account - Scrap Express',
      description: 'Your Scrap Express requests and business details.',
      noindex: true,
      requests,
      firebaseConfig: firebase.clientConfig,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not load your account. Please refresh the page.');
  }
});

app.use((req, res) => {
  res.status(404).render('index', {
    page: 'home',
    title: 'Page Not Found - Scrap Express',
    description: 'The page you were looking for could not be found.',
  });
});

app.listen(PORT, () => {
  console.log(`Scrap Express server running at http://localhost:${PORT}`);
  push.init().catch(() => {}); // prepare notification keys early; logged inside if it fails
  updates.startSchedule(); // daily rates to subscribers
});
