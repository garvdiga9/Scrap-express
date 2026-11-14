require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const {
  AREAS, OTHER_AREA, SERVICE_KM, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES, MIN_PICKUP_KG, SCRAP_LOCATIONS, formatQuoteRate, readyDateRange,
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
const reviews = require('./lib/reviews');
const siteImages = require('./lib/site-images');
const lots = require('./lib/lots');
const lotsRouter = require('./routes/lots');
const adminContentRouter = require('./routes/admin-content');
const areas = require('./lib/areas');
const timeline = require('./lib/timeline');
const documents = require('./lib/documents');
const schedules = require('./lib/schedules');
const dispatch = require('./lib/dispatch');
const siteStats = require('./lib/site-stats');
const rates = require('./lib/rates');
const analytics = require('./lib/analytics');
const i18n = require('./lib/i18n');
const { SITE_URL, SITE_HOST, redirectToSiteUrl } = require('./lib/site-url');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
// Health check (before the custom-domain forwarding, so Render can always
// reach it), error counting and alerts (lib/health.js).
const health = require('./lib/health');
health.watchProcess();
app.get('/healthz', health.healthz);
app.use(health.watch);
// Once SITE_URL is a custom domain, the old address forwards to it (lib/site-url.js).
app.use(redirectToSiteUrl);
// Security headers on every response (lib/security-headers.js).
const { securityHeaders, cspReport } = require('./lib/security-headers');
app.use(securityHeaders({ production: isProduction }));
// The business name and contacts (lib/brand.js): when they're set on the
// server, they replace the current ones in every reply and app file.
const brand = require('./lib/brand');
if (brand.changed) {
  app.use((req, res, next) => {
    const send = res.send.bind(res);
    res.send = (body) => send(typeof body === 'string' ? brand.brandify(body) : body);
    next();
  });
  // Static pages and app files (admin, staff, offline page, manifests,
  // scripts), read once and kept with the new details.
  const brandedFiles = new Map();
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json' };
  app.get(/\.(html|js|webmanifest)$/, async (req, res, next) => {
    const ext = path.extname(req.path);
    const file = path.join(__dirname, 'public', path.normalize(req.path).replace(/^([\\/]\.\.)+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public') + path.sep)) return next();
    try {
      if (!brandedFiles.has(file)) brandedFiles.set(file, brand.brandify(await require('fs/promises').readFile(file, 'utf8')));
      res.type(TYPES[ext]).set('Cache-Control', 'no-cache').send(brandedFiles.get(file));
    } catch (err) {
      next();
    }
  });
}
// Browsers send what the security policy blocked here (logged).
app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/json', 'application/reports+json'], limit: '20kb' }), cspReport);
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

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /admin.html',
    'Disallow: /staff.html',
    'Disallow: /account',
    'Disallow: /login',
    'Disallow: /quote/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'));
});

// The public pages, so search engines find them all (PAGES is defined below),
// plus a page for every area and every scrap rate.
app.get('/sitemap.xml', async (req, res) => {
  const entries = PAGES.map(({ path: pagePath, priority }) => ({
    path: pagePath, priority, changefreq: pagePath === '/rates' ? 'daily' : 'weekly',
  }));
  try {
    const [areaList, rateList] = await Promise.all([areas.listAreas(), rates.listRates()]);
    areaList.forEach((area) => entries.push({ path: `/areas/${area.slug}`, priority: '0.7', changefreq: 'monthly' }));
    rateList.filter((rate) => rate.url).forEach((rate) => entries.push({ path: rate.url, priority: '0.7', changefreq: 'daily' }));
  } catch (err) {
    console.error('sitemap: area/rate pages left out', err);
  }
  const urls = entries.map((e) => `  <url>
    <loc>${SITE_URL}${e.path}</loc>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
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

// Taps on the phone number and WhatsApp links (public/js/main.js). Only these
// two can be sent from a page; forms are counted where they're received.
const recentTracks = new Map();
app.post('/api/track', (req, res) => {
  const event = String((req.body && req.body.event) || '');
  if (!analytics.CLIENT_EVENTS.has(event)) return res.status(400).end();
  const now = Date.now();
  const times = (recentTracks.get(req.ip) || []).filter((t) => t > now - 60 * 60 * 1000);
  if (times.length < 60) {
    times.push(now);
    recentTracks.set(req.ip, times);
    if (recentTracks.size > 5000) recentTracks.clear();
    analytics.record(event, analytics.pageFrom(req) || String((req.body && req.body.page) || ''));
  }
  res.status(204).end();
});

app.use('/api/subscribe', express.urlencoded({ extended: false }), subscribeRouter);
app.use('/api/location', locationRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/callback', express.urlencoded({ extended: false }), callbackRouter);
app.use('/api/rates', ratesRouter);
app.use('/api/pickup', pickupRouter);
app.use('/api/demolition', demolitionRouter);
app.use('/api/testimonials', testimonialsRouter);
// Every change made in the dashboard is written to the activity log.
app.use('/api/admin', require('./lib/activity').middleware);
app.use('/api/admin', adminRouter);
app.use('/api/admin', adminContentRouter); // photos, lots for sale, enquiries
app.use('/api/staff', require('./routes/staff'));
app.use('/api/lots', express.urlencoded({ extended: false }), lotsRouter);
app.use('/api/customer', customerRouter);

app.use(express.static(path.join(__dirname, 'public')));
// Photos the owner adds for the site (lib/site-images.js). Every file has a
// unique name, so browsers can keep it for a year.
app.use('/site-images', express.static(siteImages.SITE_DIR, { maxAge: '365d', immutable: true, index: false }));

// Page views for Admin → Analytics (totals only; no cookies).
app.use(analytics.countPageView);

// Hindi / English for the pages (lib/i18n.js), and the dictionary for the browser.
app.get('/js/i18n-hi.js', (req, res) => {
  // Checked each time (a quick "not changed" via the ETag), so new Hindi text
  // shows straight after an update.
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(i18n.clientScript());
});
app.use(i18n.middleware);

// Pages (not static files or the API) know who's logged in, so the header can
// show "My Account" and the booking form can auto-fill.
app.use(async (req, res, next) => {
  // Each language has its own address for search engines: the Hindi page is ?lang=hi.
  res.locals.englishUrl = `${SITE_URL}${req.path}`;
  res.locals.hindiUrl = `${SITE_URL}${req.path}?lang=hi`;
  res.locals.canonicalUrl = res.locals.lang === 'hi' ? res.locals.hindiUrl : res.locals.englishUrl;
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
app.locals.scrapLocations = SCRAP_LOCATIONS;
app.locals.minPickupKg = MIN_PICKUP_KG;
app.locals.mediaLimits = media.LIMITS;
app.locals.statusLabels = {
  pending: 'Received', quoted: 'Quote Ready', accepted: 'Quote Accepted', declined: 'Quote Declined',
  slots_sent: 'Choose a Pickup Slot', scheduled: 'Pickup Scheduled', on_way: 'On the Way', arrived: 'Team Arrived', weighed: 'Weighed',
  ready: 'Ready for Pickup', confirmed: 'Confirmed', completed: 'Completed', no_scrap: 'No Scrap at Site', cancelled: 'Cancelled',
};
app.locals.formatQuoteRate = formatQuoteRate;
app.locals.reviewHelpers = reviews;
app.locals.rateCategories = rates.RATE_CATEGORIES;
app.locals.trendDays = rates.TREND_DAYS;
app.locals.formatIndiaTime = rates.formatIndiaTime;
app.locals.galleryCategories = siteImages.GALLERY_CATEGORIES;
app.locals.formatLotQuantity = lots.formatQuantity;
app.locals.siteUrl = SITE_URL;
app.locals.siteHost = SITE_HOST;
// Google Analytics 4 (optional): set GA_MEASUREMENT_ID ("G-XXXXXXX") on Render.
app.locals.gaMeasurementId = /^G-[A-Z0-9]{4,20}$/.test(process.env.GA_MEASUREMENT_ID || '') ? process.env.GA_MEASUREMENT_ID : '';
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
    description: `Sell scrap in Delhi NCR to Scrap Express: bulk scrap buyers for factories, offices, hospitals, hotels and restaurants. Pickup from ${MIN_PICKUP_KG} kg, weighbridge weight, GST invoice, cash or bank payment.`,
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
    path: '/buy-from-us', view: 'buy-from-us', page: 'buy-from-us', priority: '0.7',
    title: 'Buy Baled Scrap: Kraft Paper, PET, Steel, Aluminium | Scrap Express',
    description: 'Recyclers and mills: buy sorted, baled scrap lots from Scrap Express in Delhi NCR. Kraft paper, PET bottles, GI sheet, steel and aluminium, with grade, quantity and photos.',
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

// Data some pages draw on the server (so it shows without JavaScript and
// search engines see it). If loading fails, the page still renders without it.
const PAGE_DATA = {
  '/': async () => {
    const [list, stats, rateList, gallery, logos] = await Promise.all([
      reviews.listReviews(), siteStats.getStats(), rates.listRates(), siteImages.list('gallery'), siteImages.list('logo'),
    ]);
    return {
      reviews: list, stats, rates: rateList, gallery, logos,
    };
  },
  '/buy-from-us': async () => ({ lots: await lots.listLots() }),
  '/areas': async () => ({ areaPages: await areas.listAreas() }),
  '/rates': async () => {
    const [rateList, ratesUpdated] = await Promise.all([rates.listRates(), rates.lastUpdated()]);
    return { rates: rateList, ratesUpdated };
  },
};

PAGES.forEach(({ path: routePath, view, page, title, description }) => {
  app.get(routePath, async (req, res, next) => {
    let data = {};
    try {
      if (PAGE_DATA[routePath]) data = await PAGE_DATA[routePath](req);
    } catch (err) {
      console.error(`loading data for ${routePath} failed`, err);
    }
    res.render(view, { page, title, description, ...data }, (err, html) => (err ? next(err) : res.send(html)));
  });
});

// ---- one page per area and per scrap rate (for local and material searches) ----

// Search results show about 60 characters of a title: use the shorter one when needed.
const fitTitle = (full, short) => (full.length <= 65 ? full : short);

const notFound = (req, res) => res.status(404).render('notice', {
  page: 'notice', noindex: true, title: 'Page not found - Scrap Express', description: 'Page not found.',
  icon: 'icon-close', heading: 'Page not found', message: "We couldn't find that page. It may have moved.",
});

app.get('/areas/:slug', async (req, res, next) => {
  try {
    const area = await areas.getArea(req.params.slug);
    if (!area) return notFound(req, res);
    const rateList = await rates.listRates().catch(() => []);
    res.render('area', {
      page: 'areas',
      title: fitTitle(`Scrap Buyer in ${area.name} | Bulk Scrap Pickup | Scrap Express`, `Scrap Buyer in ${area.name} | Scrap Express`),
      description: `Sell bulk scrap in ${area.name}: we buy paper, plastic, metal and e-waste from businesses. Weighbridge weight, GST invoice, cash or bank payment.`,
      area,
      faqs: areas.areaFaqs(area, { minPickupKg: MIN_PICKUP_KG, serviceKm: SERVICE_KM }),
      rates: rateList,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/rates/:slug', async (req, res, next) => {
  try {
    const rate = await rates.getRateBySlug(req.params.slug);
    if (!rate) return notFound(req, res);
    const [rateList, ratesUpdated] = await Promise.all([rates.listRates(), rates.lastUpdated()]);
    const shortName = rates.shortName(rate.name);
    const per = rate.unit === 'kg' ? '/kg' : ` per ${rate.unit}`;
    res.render('rate', {
      page: 'rates',
      title: fitTitle(`${shortName} Scrap Rate Today in Delhi (₹${rate.priceText}${per}) | Scrap Express`, `${shortName} Scrap Rate Today (₹${rate.priceText}${per}) | Scrap Express`),
      description: `Today's ${shortName.toLowerCase()} scrap rate in Delhi NCR: ₹${rate.priceText}${per}. ${rate.trend.label}. Bulk lots: weighbridge weight and GST invoice.`,
      rate,
      shortName,
      ratesUpdated,
      related: rateList.filter((r) => r.category === rate.category && r.id !== rate.id).slice(0, 4),
    });
  } catch (err) {
    next(err);
  }
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
// The printable pickup receipt, from the private quote link (also linked from
// My Account and the admin).
app.get('/quote/:token/receipt', async (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) return notFound(req, res);
    const { rows: [extra] } = await pool.query('SELECT name, address, weighed_at FROM pickup_requests WHERE id = $1', [request.id]);
    const details = (await dispatch.customerView([request.id])).get(request.id);
    if (!details || !details.items) return notFound(req, res);
    res.render('receipt', { r: { ...request, ...extra, pickup: details } });
  } catch (err) {
    next(err);
  }
});

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
    const [events, docs, pickupDetails] = await Promise.all([
      timeline.eventsFor('pickup', [request.id]),
      documents.listFor('pickup', [request.id]),
      dispatch.customerView([request.id]),
    ]);
    request.pickup = pickupDetails.get(request.id) || null;
    res.render('quote', {
      timeline: timeline.buildTimeline('pickup', request, events.get(request.id) || []),
      docs,
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
    const customerId = res.locals.customer.id;
    const requests = await customers.listRequests(customerId);
    const idsOf = (kind) => requests.filter((r) => r.kind === kind).map((r) => r.id);
    const [pickupEvents, demolitionEvents, pickupDocs, demolitionDocs, repeatPickups] = await Promise.all([
      timeline.eventsFor('pickup', idsOf('pickup')),
      timeline.eventsFor('demolition', idsOf('demolition')),
      documents.listFor('pickup', idsOf('pickup')),
      documents.listFor('demolition', idsOf('demolition')),
      schedules.listForCustomer(customerId),
    ]);
    const pickupDetails = await dispatch.customerView(idsOf('pickup'));
    requests.forEach((r) => {
      if (r.kind === 'pickup') r.pickup = pickupDetails.get(r.id) || null;
      const events = (r.kind === 'pickup' ? pickupEvents : demolitionEvents).get(r.id) || [];
      r.timeline = timeline.buildTimeline(r.kind, r, events);
      r.docs = (r.kind === 'pickup' ? pickupDocs : demolitionDocs).filter((d) => d.request_id === r.id);
    });
    res.render('account', {
      repeatPickups,
      repeatFrequencies: schedules.FREQUENCIES,
      repeatDates: schedules.dateRange(),
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

// Anything that went wrong and wasn't handled: a friendly page, logged and counted.
app.use(health.errorHandler(NOTICE));

app.listen(PORT, () => {
  console.log(`Scrap Express server running at http://localhost:${PORT}`);
  push.init().catch(() => {}); // prepare notification keys early; logged inside if it fails
  updates.startSchedule(); // daily rates to subscribers
  schedules.start(); // repeat pickups customers have set up
  dispatch.start(); // tells the owner when nobody chose a pickup slot in time
  require('./lib/activity').start(); // clears activity log entries older than a year
  require('./lib/reminders').start(); // morning to-do alerts, and nudges for customers
  quotes.addMissingTokens().catch((err) => console.error('adding quote links failed:', err.message));
});
