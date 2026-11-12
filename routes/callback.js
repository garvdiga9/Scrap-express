// POST /api/callback - public: someone with a question asks us to call them.
const router = require('express').Router();
const pool = require('../db/pool');
const { PHONE_ERROR, cleanPhone } = require('../lib/validation');
const push = require('../lib/push');
const live = require('../lib/live');
const analytics = require('../lib/analytics');
const { reply } = require('../lib/reply');

const MAX_NAME = 150;
const MAX_QUERY = 1000;

// Anyone can send this, so cap it per connection to stop a script flooding the list.
const PER_HOUR = 5;
const recent = new Map();
function tooMany(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recent.get(ip) || []).filter((t) => t > hourAgo);
  if (times.length >= PER_HOUR) return true;
  times.push(Date.now());
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return false;
}

const SUCCESS = "Thanks! We'll call you back soon, during our working hours.";

router.post('/', async (req, res) => {
  const fail = (status, error) => reply(req, res, status, { error });
  // A hidden field people never see: only bots fill it in, and they're told it worked.
  if (req.body.website) return reply(req, res, 201, { message: SUCCESS });

  const name = String(req.body.name ?? '').trim();
  const query = String(req.body.query ?? '').trim();
  if (!name || !req.body.phone || !query) {
    return fail(400, 'Please fill in your name, phone number and query.');
  }
  if (name.length > MAX_NAME) return fail(400, 'Please shorten your name.');
  if (query.length > MAX_QUERY) return fail(400, `Please keep your query under ${MAX_QUERY} characters.`);
  const phone = cleanPhone(req.body.phone);
  if (!phone) return fail(400, PHONE_ERROR);
  if (tooMany(req.ip)) {
    return fail(429, 'Too many requests from your connection. Please call us on +91 98188 26333.');
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO callback_requests (name, phone, query, customer_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, phone, query, (req.session && req.session.customerId) || null]
    );
    reply(req, res, 201, { message: SUCCESS });
    live.publish('callbacks');
    analytics.record('callback_request', analytics.pageFrom(req));
    push.quietly(push.notifyAdmins({
      title: `Call back request 📞 ${name}`,
      body: `${phone}: ${query.slice(0, 100)}`,
      url: `/admin.html#callback-${rows[0].id}`,
      tag: `callback-${rows[0].id}`,
    }));
  } catch (err) {
    console.error(err);
    fail(500, 'Something went wrong. Please call us on +91 98188 26333.');
  }
});

module.exports = router;
