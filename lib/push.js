// Push notifications to phones and browsers (Web Push).
// Customers get told when their quote is ready or their pickup changes;
// the admin gets told about new requests and quote answers.
//
// The VAPID keys that sign the notifications are created on first start and
// kept in app_settings, so nothing needs configuring. VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY in the environment override them if ever needed.
const webpush = require('web-push');
const pool = require('../db/pool');

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
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://scrap-express.onrender.com', keys.publicKey, keys.privateKey);
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

async function subscribe(sub, { customerId = null, admin = false }) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, customer_id, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       customer_id = COALESCE(EXCLUDED.customer_id, push_subscriptions.customer_id),
       is_admin = push_subscriptions.is_admin OR EXCLUDED.is_admin`,
    [sub.endpoint, sub.p256dh, sub.auth, customerId, admin]
  );
}

// Turn notifications off for one role on a device; the row goes once it
// belongs to nobody.
async function unsubscribe(endpoint, { customerId = null, admin = false }) {
  if (admin) {
    await pool.query('UPDATE push_subscriptions SET is_admin = FALSE WHERE endpoint = $1', [endpoint]);
  } else {
    await pool.query('UPDATE push_subscriptions SET customer_id = NULL WHERE endpoint = $1 AND customer_id = $2', [endpoint, customerId]);
  }
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND customer_id IS NULL AND NOT is_admin', [endpoint]);
}

async function isSubscribed(endpoint, { customerId = null, admin = false }) {
  const { rows } = await pool.query(
    admin
      ? 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND is_admin'
      : 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND customer_id = $2',
    admin ? [endpoint] : [endpoint, customerId]
  );
  return rows.length > 0;
}

async function sendTo(rows, notification) {
  if (!rows.length) return 0;
  await init();
  const payload = JSON.stringify(notification);
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

async function notifyAdmins(notification) {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE is_admin');
  return sendTo(rows, notification);
}

// Fire-and-forget wrappers for use inside request handlers: a notification
// problem must never fail the action that triggered it.
const quietly = (promise) => promise.catch((err) => console.error('Notification failed:', err.message));

module.exports = {
  init, getPublicKey, cleanSubscription, subscribe, unsubscribe, isSubscribed,
  notifyCustomer, notifyAdmins, quietly,
};
