// Is the site healthy, and does the owner hear when it isn't?
//  - GET /healthz answers 200 only when the site AND the database work.
//    Render uses it to decide a new version is ready (render.yaml), and an
//    outside monitor such as UptimeRobot can ping it every few minutes.
//  - Errors are counted. When there are 5 or more in 10 minutes, the admin
//    app gets an alert (at most one an hour), so a broken feature is noticed
//    before customers call.
//  - errorHandler() shows a friendly page (or JSON for the apps) instead of
//    Express's raw error output.
const pool = require('../db/pool');
const push = require('./push');

const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD = 5;
const ALERT_GAP_MS = 60 * 60 * 1000;
let errors = []; // { at, what }
let lastAlert = 0;

function record(what) {
  const now = Date.now();
  errors = errors.filter((e) => e.at > now - WINDOW_MS);
  errors.push({ at: now, what: String(what).slice(0, 160) });
  if (errors.length >= THRESHOLD && now - lastAlert > ALERT_GAP_MS) {
    lastAlert = now;
    push.quietly(push.notifyAdmins({
      title: 'Website errors ⚠️',
      body: `${errors.length} errors in the last 10 minutes. Latest: ${errors[errors.length - 1].what}. Check Render → Logs.`,
      url: '/admin.html',
      tag: 'site-errors',
    }));
  }
}

// Counts every reply the server couldn't complete (5xx).
function watch(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode >= 500 && res.statusCode !== 503) record(`${res.statusCode} on ${req.method} ${req.path}`);
  });
  next();
}

async function healthz(req, res) {
  const started = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('database timeout')), 3000)),
    ]);
    res.set('Cache-Control', 'no-store').json({ ok: true, database: 'ok', ms: Date.now() - started, uptime: Math.round(process.uptime()) });
  } catch (err) {
    record(`health check: ${err.message}`);
    res.status(503).set('Cache-Control', 'no-store').json({ ok: false, database: err.message });
  }
}

// The last stop for an error nobody caught.
function errorHandler(notice) {
  return (err, req, res, next) => {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return res.destroy(err);
    // Bad JSON from a client is their mistake, not ours.
    if (err.type === 'entity.parse.failed' || err.status === 400) return res.status(400).json({ error: 'That request could not be read.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That was too large to send.' });
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong on our side. Please try again, or call us on +91 98188 26333.' });
    return res.status(500).render('notice', {
      ...notice,
      title: 'Something Went Wrong - Scrap Express',
      icon: 'icon-close',
      heading: 'Something went wrong',
      message: 'Sorry, this page had a problem on our side. Please try again in a minute, or call us on +91 98188 26333.',
    });
  };
}

// Crashes outside a request: logged and counted; an uncaught exception
// still stops the process (Render starts it again) after a moment to log.
function watchProcess() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    record(`unhandled: ${reason && reason.message ? reason.message : reason}`);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    record(`crash: ${err.message}`);
    setTimeout(() => process.exit(1), 1500).unref();
  });
}

module.exports = {
  record, watch, healthz, errorHandler, watchProcess,
};
