// Push notifications to phones and browsers (Web Push).
// Customers get told when their quote is ready or their pickup changes;
// the admin gets told about new requests and quote answers.
//
// The VAPID keys that sign the notifications are created on first start and
// kept in app_settings, so nothing needs configuring. VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY in the environment override them if ever needed.
const { brandify } = require('./brand');
const webpush = require('web-push');
const pool = require('../db/pool');
const { SITE_URL } = require('./site-url');

let ready = null;
let publicKey = null;

async function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'vapid_keys'");
  if (rows[0]) return JSON.parse(rows[0].value);
  const keys = webpush.generateVAPIDKeys();
  // ON CONFLICT: if two starts race, keep whichever was saved first.
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('vapid_keys', $1) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(keys)]
  );
  const { rows: saved } = await pool.query("SELECT value FROM app_settings WHERE key = 'vapid_keys'");
  return JSON.parse(saved[0].value);
}

function init() {
  if (!ready) {
    ready = loadKeys().then((keys) => {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE_URL, keys.publicKey, keys.privateKey);
      publicKey = keys.publicKey;
    });
    ready.catch((err) => {
      console.error('Push notifications unavailable:', err.message);
      ready = null; // try again on the next use
    });
  }
  return ready;
}

async function getPublicKey() {
  await init();
  return publicKey;
}

// Only real browser push services are accepted as endpoints, so the server
// can't be tricked into sending requests to arbitrary addresses.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/,
];

// Returns the cleaned subscription, or null when it isn't a valid one.
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || '');
  const auth = String(sub.keys?.auth || '');
  let url;
  try { url = new URL(endpoint); } catch (err) { return null; }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  if (endpoint.length > 1000 || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// A device can be subscribed in three independent roles: as a logged-in
// customer (quote alerts), as the admin (new requests), and for daily rates &
// news (anyone, no login).
// quoteToken: a customer without a login, following one request from its
// private link.
async function subscribe(sub, {
  customerId = null, admin = false, updates = false, staffId = null, quoteToken = null,
}) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, customer_id, is_admin, wants_updates, staff_id, quote_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       customer_id = COALESCE(EXCLUDED.customer_id, push_subscriptions.customer_id),
       staff_id = COALESCE(EXCLUDED.staff_id, push_subscriptions.staff_id),
       quote_token = COALESCE(EXCLUDED.quote_token, push_subscriptions.quote_token),
       is_admin = push_subscriptions.is_admin OR EXCLUDED.is_admin,
       wants_updates = push_subscriptions.wants_updates OR EXCLUDED.wants_updates`,
    [sub.endpoint, sub.p256dh, sub.auth, customerId, admin, updates, staffId, quoteToken]
  );
}

// Turn notifications off for one role on a device; the row goes once it
// belongs to nobody.
async function unsubscribe(endpoint, {
  customerId = null, admin = false, updates = false, staffId = null, quoteToken = null,
}) {
  if (quoteToken) {
    await pool.query('UPDATE push_subscriptions SET quote_token = NULL WHERE endpoint = $1 AND quote_token = $2', [endpoint, quoteToken]);
  } else if (staffId) {
    await pool.query('UPDATE push_subscriptions SET staff_id = NULL WHERE endpoint = $1 AND staff_id = $2', [endpoint, staffId]);
  } else if (admin) {
    await pool.query('UPDATE push_subscriptions SET is_admin = FALSE WHERE endpoint = $1', [endpoint]);
  } else if (updates) {
    await pool.query('UPDATE push_subscriptions SET wants_updates = FALSE WHERE endpoint = $1', [endpoint]);
  } else {
    await pool.query('UPDATE push_subscriptions SET customer_id = NULL WHERE endpoint = $1 AND customer_id = $2', [endpoint, customerId]);
  }
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND customer_id IS NULL AND staff_id IS NULL AND quote_token IS NULL AND NOT is_admin AND NOT wants_updates',
    [endpoint]
  );
}

async function isSubscribed(endpoint, {
  customerId = null, admin = false, updates = false, staffId = null, quoteToken = null,
}) {
  if (quoteToken) {
    const { rows: mine } = await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND quote_token = $2', [endpoint, quoteToken]);
    return mine.length > 0;
  }
  if (staffId) {
    const { rows: mine } = await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND staff_id = $2', [endpoint, staffId]);
    return mine.length > 0;
  }
  let sql = 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND customer_id = $2';
  if (admin) sql = 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND is_admin';
  if (updates) sql = 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND wants_updates';
  const { rows } = await pool.query(sql, admin || updates ? [endpoint] : [endpoint, customerId]);
  return rows.length > 0;
}

async function sendTo(rows, notification) {
  if (!rows.length) return 0;
  await init();
  const payload = brandify(JSON.stringify(notification));
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      );
      sent += 1;
      await pool.query('UPDATE push_subscriptions SET last_sent_at = NOW() WHERE id = $1', [row.id]);
    } catch (err) {
      // 404/410: the device unsubscribed or the app was removed. Forget it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
      } else {
        console.error('Push send failed:', err.statusCode || '', err.body || err.message);
      }
    }
  }));
  return sent;
}

// notification: { title, body, url, tag }
async function notifyCustomer(customerId, notification) {
  if (!customerId) return 0;
  const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE customer_id = $1', [customerId]);
  return sendTo(rows, notification);
}

// Devices following one request from its private link (skipping the ones
// that already get it through the customer's account).
async function notifyToken(token, notification, exceptCustomerId = null) {
  if (!token) return 0;
  const { rows } = await pool.query(
    'SELECT * FROM push_subscriptions WHERE quote_token = $1 AND ($2::int IS NULL OR customer_id IS NULL OR customer_id <> $2)',
    [token, exceptCustomerId]
  );
  return sendTo(rows, notification);
}

// A request's customer on every device: their account and the private link.
async function notifyRequest(row, notification) {
  const [a, b] = await Promise.all([notifyCustomer(row.customer_id, notification), notifyToken(row.quote_token, notification, row.customer_id)]);
  return a + b;
}

// Staff phones: everyone active, one person, or everyone but one.
async function notifyStaff(notification, { onlyId = null, exceptId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT p.* FROM push_subscriptions p JOIN staff_users s ON s.id = p.staff_id
     WHERE s.active AND ($1::int IS NULL OR s.id = $1) AND ($2::int IS NULL OR s.id <> $2)`,
    [onlyId, exceptId]
  );
  return sendTo(rows, notification);
}

async function notifyAdmins(notification) {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE is_admin');
  return sendTo(rows, notification);
}

async function notifyUpdateSubscribers(notification) {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE wants_updates');
  return sendTo(rows, notification);
}

// Fire-and-forget wrappers for use inside request handlers: a notification
// problem must never fail the action that triggered it.
const quietly = (promise) => promise.catch((err) => console.error('Notification failed:', err.message));

module.exports = {
  init, getPublicKey, cleanSubscription, subscribe, unsubscribe, isSubscribed,
  notifyCustomer, notifyToken, notifyRequest, notifyAdmins, notifyStaff, notifyUpdateSubscribers, quietly,
};
