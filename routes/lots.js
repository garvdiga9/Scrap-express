// POST /api/lots/enquiry - public: a recycler asks about a lot on "Buy from us".
const router = require('express').Router();
const pool = require('../db/pool');
const lots = require('../lib/lots');
const {
  PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanEmail,
} = require('../lib/validation');
const { reply } = require('../lib/reply');
const push = require('../lib/push');
const live = require('../lib/live');
const analytics = require('../lib/analytics');

// Anyone can send this, so cap it per connection.
const PER_HOUR = 8;
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

const SUCCESS = "Thanks! We've got your enquiry and will call you soon with the price and details.";

router.post('/enquiry', async (req, res) => {
  const fail = (status, error) => reply(req, res, status, { error });
  if (req.body.website) return reply(req, res, 201, { message: SUCCESS }); // hidden field only bots fill in

  const name = String(req.body.name ?? '').trim().slice(0, 150);
  const company = String(req.body.company ?? '').trim().slice(0, 200) || null;
  const message = String(req.body.message ?? '').trim().slice(0, 1000) || null;
  if (!name || !req.body.phone) return fail(400, 'Please fill in your name and phone number.');
  const phone = cleanPhone(req.body.phone);
  if (!phone) return fail(400, PHONE_ERROR);
  const typedEmail = String(req.body.email ?? '').trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) return fail(400, EMAIL_ERROR);
  const lot = await lots.getLot(Number(req.body.lotId)).catch(() => null);
  if (!lot || lot.status === 'sold') return fail(400, 'This lot has just been sold. Please call us for similar stock.');
  if (tooMany(req.ip)) return fail(429, 'Too many enquiries from your connection. Please call us on +91 98188 26333.');

  try {
    const { rows } = await pool.query(
      `INSERT INTO lot_enquiries (lot_id, lot_title, name, company, phone, email, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [lot.id, lot.title, name, company, phone, email, message]
    );
    reply(req, res, 201, { message: SUCCESS });
    live.publish('lots');
    analytics.record('lot_enquiry', analytics.pageFrom(req));
    push.quietly(push.notifyAdmins({
      title: `Enquiry to buy: ${lot.title} 🛒`,
      body: `${company || name} · ${phone}`,
      url: `/admin.html#lots-${rows[0].id}`,
      tag: `lot-enquiry-${rows[0].id}`,
    }));
  } catch (err) {
    console.error(err);
    fail(500, 'Something went wrong. Please call us on +91 98188 26333.');
  }
});

module.exports = router;
