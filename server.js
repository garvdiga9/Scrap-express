require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const { AREAS, BUSINESS_TYPES, SCRAP_TYPES, PICKUP_FREQUENCIES } = require('./data/business');
const ratesRouter = require('./routes/rates');
const pickupRouter = require('./routes/pickup');
const demolitionRouter = require('./routes/demolition');
const testimonialsRouter = require('./routes/testimonials');
const adminRouter = require('./routes/admin');

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

app.use('/api/rates', ratesRouter);
app.use('/api/pickup', pickupRouter);
app.use('/api/demolition', demolitionRouter);
app.use('/api/testimonials', testimonialsRouter);
app.use('/api/admin', adminRouter);

app.use(express.static(path.join(__dirname, 'public')));

// ---- page routes ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.areas = AREAS;
app.locals.businessTypes = BUSINESS_TYPES;
app.locals.scrapTypes = SCRAP_TYPES;
app.locals.pickupFrequencies = PICKUP_FREQUENCIES;

const PAGES = [
  { path: '/', view: 'index', page: 'home', title: 'Scrap Express - Bulk Scrap Buyers for Businesses in Delhi NCR', description: 'Scrap Express buys scrap in bulk from factories, offices, hospitals, schools, malls and hotels across Delhi NCR. GST invoice, weighbridge slips and bank transfer payment.' },
  { path: '/rates', view: 'rates', page: 'rates', title: 'Indicative Scrap Rates in Delhi - Scrap Express', description: 'Indicative per-kg scrap rates in Delhi for paper, plastic, iron, copper, brass, aluminium, wires and more. Request a bulk quote for business volumes.' },
  { path: '/what-we-buy', view: 'what-we-buy', page: 'what-we-buy', title: 'What We Buy - Industrial & Office Scrap - Scrap Express', description: 'We buy AC plants, generators, motors, IT equipment, office furniture, glass and more from businesses across Delhi NCR. Quotes based on volume and condition.' },
  { path: '/book-pickup', view: 'book-pickup', page: 'book-pickup', title: 'Request a Bulk Scrap Pickup in Delhi NCR - Scrap Express', description: 'Request a one-time or scheduled bulk scrap pickup from your factory, office or site in Delhi NCR. GST invoice, weighbridge slip, payment by bank transfer.' },
  { path: '/demolition', view: 'demolition', page: 'demolition', title: 'Commercial Demolition Services in Delhi NCR - Scrap Express', description: 'Demolition of schools, hospitals, factories, warehouses, malls and commercial buildings across Delhi NCR, with site survey and detailed quote.' },
  { path: '/areas', view: 'areas', page: 'areas', title: 'Industrial Areas We Serve in Delhi NCR - Scrap Express', description: 'Scrap Express collects bulk scrap from businesses in Okhla, Naraina, Mayapuri, Wazirpur, Bawana, Noida, Gurugram, Manesar, Faridabad and across Delhi NCR.' },
];

PAGES.forEach(({ path: routePath, view, page, title, description }) => {
  app.get(routePath, (req, res) => res.render(view, { page, title, description }));
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
});
