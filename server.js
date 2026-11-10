require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const {
  AREAS, OTHER_AREA, SERVICE_KM, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, formatQuoteRate, readyDateRange,
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
const locationRouter = require('./routes/location');
const quoteRouter = require('./routes/quote');
const callbackRouter = require('./routes/callback');
const quotes = require('./lib/quotes');
const customers = require('./lib/customers');
const live = require('./lib/live');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json());

// One line per API call, so a request that stalls or gets dropped shows up in
// the server log (locally and in Render's Logs tab).
app.use('/api', (req, res, next) => {
  if (req.path === '/live') return next(); // stays open for as long as a page does
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

// ---- for search engines ----
const SITE_URL = (process.env.SITE_URL || 'https://scrap-express.onrender.com').replace(/\/$/, '');

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /admin.html',
    'Disallow: /account',
    'Disallow: /login',
    'Disallow: /quote/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'));
});

// The public pages, so search engines find them all (PAGES is defined below).
app.get('/sitemap.xml', (req, res) => {
  const urls = PAGES.map(({ path: pagePath, priority }) => `  <url>
    <loc>${SITE_URL}${pagePath}</loc>
    <changefreq>${pagePath === '/rates' ? 'daily' : 'weekly'}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
});

// Public key browsers need to subscribe to push notifications.
app.get('/api/push/key', async (req, res) => {
  try {
    res.json({ publicKey: await push.getPublicKey() });
  } catch (err) {
    res.status(503).json({ error: 'Notifications are not available right now.' });
  }
});

app.get('/api/live', live.connect);

app.use('/api/subscribe', express.urlencoded({ extended: false }), subscribeRouter);
app.use('/api/location', locationRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/callback', callbackRouter);
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
  res.locals.canonicalUrl = `${SITE_URL}${req.path}`;
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
app.locals.otherArea = OTHER_AREA;
app.locals.serviceKm = SERVICE_KM;
app.locals.businessTypes = BUSINESS_TYPES;
app.locals.scrapTypes = SCRAP_TYPES;
app.locals.pickupFrequencies = PICKUP_FREQUENCIES;
app.locals.minPickupKg = MIN_PICKUP_KG;
app.locals.mediaLimits = media.LIMITS;
app.locals.statusLabels = {
  pending: 'Received', quoted: 'Quote Ready', accepted: 'Quote Accepted', declined: 'Quote Declined',
  ready: 'Ready for Pickup', confirmed: 'Confirmed', completed: 'Completed', no_scrap: 'No Scrap at Site', cancelled: 'Cancelled',
};
app.locals.formatQuoteRate = formatQuoteRate;
app.locals.siteUrl = SITE_URL;
// Search Console / Bing Webmaster ownership codes, set on Render once the
// owner adds the site there.
app.locals.googleVerification = process.env.GOOGLE_SITE_VERIFICATION || '';
app.locals.bingVerification = process.env.BING_SITE_VERIFICATION || '';
// Words people type when they want to sell scrap. Search engines mostly read
// the titles, descriptions and page text; these are a light extra hint.
app.locals.siteKeywords = 'sell scrap Delhi, scrap buyer Delhi NCR, bulk scrap buyer, scrap dealer near me, kabadiwala, '
  + 'scrap rates today Delhi, industrial scrap buyer, e-waste buyer Delhi, raddi, scrap pickup Gurugram Noida Faridabad';

// Each page's title and description are what search results show.
const PAGES = [
  {
    path: '/', view: 'index', page: 'home', priority: '1.0',
    title: 'Sell Scrap in Delhi NCR | Bulk Scrap Buyers | Scrap Express',
    description: 'Sell scrap in Delhi NCR to Scrap Express: bulk scrap buyers for factories, offices, hospitals, hotels and restaurants. Pickup from 300 kg, weighbridge weight, GST invoice, cash or bank payment.',
  },
  {
    path: '/rates', view: 'rates', page: 'rates', priority: '0.9',
    title: 'Scrap Rates Today in Delhi NCR (per kg) | Scrap Express',
    description: "Today's scrap rates per kg in Delhi NCR: newspaper (raddi), cardboard, plastic, iron, copper, brass, aluminium and more. Get a bulk quote for business lots.",
  },
  {
    path: '/what-we-buy', view: 'what-we-buy', page: 'what-we-buy', priority: '0.8',
    title: 'We Buy Old AC, E-Waste & Industrial Scrap | Scrap Express',
    description: 'We buy old ACs, generators, motors, computers and e-waste, office furniture, glass and industrial scrap from businesses in Delhi NCR. Quotes on volume and condition.',
  },
  {
    path: '/book-pickup', view: 'book-pickup', page: 'book-pickup', priority: '0.9',
    title: 'Sell Scrap Online: Book a Bulk Pickup in Delhi NCR | Scrap Express',
    description: 'Sell scrap online: book a one-time or scheduled bulk scrap pickup from your factory, office or site in Delhi NCR or within 50 km of Delhi. Weighbridge weight, GST invoice.',
  },
  {
    path: '/demolition', view: 'demolition', page: 'demolition', priority: '0.8',
    title: 'Building Demolition Services in Delhi NCR | Scrap Express',
    description: 'Demolition of schools, hospitals, factories, warehouses, malls and commercial buildings in Delhi NCR and within 50 km of Delhi, with a site survey and detailed quote.',
  },
  {
    path: '/areas', view: 'areas', page: 'areas', priority: '0.7',
    title: 'Scrap Buyers in Okhla, Gurugram, Noida & Delhi NCR | Scrap Express',
    description: 'Scrap dealer for businesses in Okhla, Naraina, Mayapuri, Wazirpur, Bawana, Noida, Gurugram, Manesar, Faridabad and Ghaziabad, and anywhere within 50 km of Delhi.',
  },
  {
    path: '/rules', view: 'rules', page: 'rules', priority: '0.3',
    title: 'Pickup & Demolition Rules - Scrap Express',
    description: 'The rules for bulk scrap pickups and demolition requests with Scrap Express: accurate details, weighbridge weight, scrap quality and being ready for the truck.',
  },
  {
    path: '/privacy', view: 'privacy', page: 'privacy', priority: '0.2',
    title: 'Privacy Policy - Scrap Express',
    description: 'How Scrap Express collects, uses and protects information from customers of our website and app.',
  },
  {
    path: '/delete-account', view: 'delete-account', page: 'delete-account', priority: '0.2',
    title: 'Delete Your Account - Scrap Express',
    description: 'How to delete your Scrap Express account and what happens to your data.',
  },
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

// The private quote link: no login, so it mustn't be cached or leak elsewhere.
app.get('/quote/:token', async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) {
      return res.status(404).render('notice', {
        ...NOTICE,
        title: 'Quote Not Found - Scrap Express',
        icon: 'icon-close',
        heading: "We couldn't find this quote",
        message: 'This link may be incomplete, or the request may have been removed. Please call us on +91 98188 26333 and we will help.',
      });
    }
    res.render('quote', {
      page: 'quote',
      title: `Your Quote #${request.id} - Scrap Express`,
      description: 'Your Scrap Express quote.',
      noindex: true,
      r: request,
      token: req.params.token,
      readyDates: readyDateRange(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not load this quote. Please refresh the page.');
  }
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
      readyDates: readyDateRange(),
      firebaseConfig: firebase.clientConfig,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not load your account. Please refresh the page.');
  }
});

app.use((req, res) => {
  res.status(404).render('notice', {
    ...NOTICE,
    title: 'Page Not Found - Scrap Express',
    icon: 'icon-close',
    heading: 'Page not found',
    message: "This page doesn't exist or may have moved. Our home page has everything you need.",
  });
});

app.listen(PORT, () => {
  console.log(`Scrap Express server running at http://localhost:${PORT}`);
  push.init().catch(() => {}); // prepare notification keys early; logged inside if it fails
  updates.startSchedule(); // daily rates to subscribers
  quotes.addMissingTokens().catch((err) => console.error('adding quote links failed:', err.message));
});
