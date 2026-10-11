require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
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

const PAGES = [
  { path: '/', view: 'index', page: 'home', title: 'Scrap Express - Delhi\'s Trusted Online Scrap Pickup', description: 'Scrap Express offers doorstep scrap pickup across Delhi with the best market rates, instant cash payment, and eco-friendly recycling.' },
  { path: '/rates', view: 'rates', page: 'rates', title: 'Live Scrap Rates in Delhi - Scrap Express', description: 'Today\'s scrap rates in Delhi for paper, plastic, iron, copper, brass, aluminium, wires and more. Use our calculator to estimate what your scrap is worth.' },
  { path: '/what-we-buy', view: 'what-we-buy', page: 'what-we-buy', title: 'What We Buy - AC, Fridge, Generators & More - Scrap Express', description: 'We buy AC units, fridges, generators, motors, computers, furniture, glass and more across Delhi NCR. Free pickup and on-the-spot valuation.' },
  { path: '/book-pickup', view: 'book-pickup', page: 'book-pickup', title: 'Book a Scrap Pickup in Delhi - Scrap Express', description: 'Book a doorstep scrap pickup anywhere in Delhi NCR. Same-day and next-day slots, transparent digital weighing, cash or UPI payment.' },
  { path: '/demolition', view: 'demolition', page: 'demolition', title: 'Building Demolition Services in Delhi - Scrap Express', description: 'Safe, licensed demolition of schools, factories, warehouses and commercial buildings across Delhi NCR, with free site survey and quote.' },
  { path: '/areas', view: 'areas', page: 'areas', title: 'Areas We Serve Across Delhi NCR - Scrap Express', description: 'Scrap Express collects scrap across Delhi NCR including Dwarka, Rohini, Saket, Lajpat Nagar, Janakpuri, Noida and Gurugram.' },
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
