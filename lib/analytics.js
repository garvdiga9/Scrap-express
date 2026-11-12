// Simple, private analytics: page views and conversions (quote requests,
// calls, WhatsApp clicks…) counted per day and page in analytics_daily.
// Only totals are kept: no cookies, no IP addresses, nothing about who.
// Shown in Admin → Analytics. Google Analytics can be added on top by
// setting GA_MEASUREMENT_ID (see views/partials/head.ejs).
const pool = require('../db/pool');

// What can be counted, and how the admin names it.
const EVENTS = {
  page_view: 'Page views',
  lead: 'Pickup step 1 (lead)',
  quote_request: 'Bulk quote requests',
  demolition_request: 'Demolition requests',
  callback_request: 'Call back requests',
  call_click: 'Phone number taps',
  whatsapp_click: 'WhatsApp taps',
  lot_enquiry: 'Buy-from-us enquiries',
  subscribe: 'Daily-rates sign-ups',
};
// Sent by the page itself (the rest are counted on the server).
const CLIENT_EVENTS = new Set(['call_click', 'whatsapp_click']);

const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|lighthouse|headless|curl|wget|python|axios|node-fetch/i;
const indiaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// "/areas/okhla-industrial-area?x=1" → "/areas/okhla-industrial-area"
const cleanPath = (p) => String(p || '').split(/[?#]/)[0].slice(0, 200) || '/';

function record(event, path = '') {
  if (!EVENTS[event]) return;
  pool.query(
    `INSERT INTO analytics_daily (day, event, path, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (day, event, path) DO UPDATE SET count = analytics_daily.count + 1`,
    [indiaDay(), event, cleanPath(path)]
  ).catch((err) => console.error('analytics', err.message));
}

// Page views, counted as pages are sent: works without JavaScript, and
// leaves out search-engine robots and private pages.
const PRIVATE = /^\/(account|login|quote\/|admin)/;
function countPageView(req, res, next) {
  if (req.method === 'GET' && !PRIVATE.test(req.path) && !BOT_RE.test(req.get('user-agent') || '')) {
    res.on('finish', () => {
      if (res.statusCode === 200 && /text\/html/.test(res.get('Content-Type') || '')) record('page_view', req.path);
    });
  }
  next();
}

// The page from a Referer header, if it's one of ours.
function pageFrom(req) {
  try {
    const ref = new URL(req.get('referer') || '');
    return ref.host === req.get('host') ? ref.pathname : '';
  } catch (err) {
    return '';
  }
}

// Totals for the last `days` days.
async function summary(days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [totals, daily, pages, conversionsByPage] = await Promise.all([
    pool.query('SELECT event, SUM(count)::int AS count FROM analytics_daily WHERE day >= $1 GROUP BY event', [since]),
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, event, SUM(count)::int AS count
       FROM analytics_daily WHERE day >= $1 GROUP BY day, event ORDER BY day`,
      [since]
    ),
    pool.query(
      `SELECT path, SUM(count)::int AS count FROM analytics_daily
       WHERE day >= $1 AND event = 'page_view' GROUP BY path ORDER BY count DESC LIMIT 15`,
      [since]
    ),
    pool.query(
      `SELECT path, SUM(count)::int AS count FROM analytics_daily
       WHERE day >= $1 AND event IN ('quote_request', 'lead', 'demolition_request', 'call_click', 'whatsapp_click', 'callback_request')
         AND path <> '' GROUP BY path ORDER BY count DESC LIMIT 10`,
      [since]
    ),
  ]);
  const byEvent = Object.fromEntries(Object.keys(EVENTS).map((e) => [e, 0]));
  totals.rows.forEach((r) => { byEvent[r.event] = r.count; });
  return {
    since, days, labels: EVENTS, totals: byEvent, daily: daily.rows, topPages: pages.rows, topConvertingPages: conversionsByPage.rows,
  };
}

module.exports = {
  EVENTS, CLIENT_EVENTS, record, countPageView, pageFrom, summary,
};
