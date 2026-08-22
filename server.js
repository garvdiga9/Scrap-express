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

app.listen(PORT, () => {
  console.log(`Kabadi Express server running at http://localhost:${PORT}`);
});
