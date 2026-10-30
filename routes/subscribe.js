// Public sign-up for daily rates & news: email / WhatsApp number, or
// notifications on this device. Mounted at /api/subscribe.
const router = require('express').Router();
const updates = require('../lib/updates');
const { mountPushRoutes } = require('./push');

// Anyone can sign up, so cap sign-ups per connection to stop a script from
// filling the list (or making us email strangers).
const SIGNUPS_PER_HOUR = 10;
const recent = new Map();
function tooMany(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recent.get(ip) || []).filter((t) => t > hourAgo);
  if (times.length >= SIGNUPS_PER_HOUR) return true;
  times.push(Date.now());
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return false;
}

const MESSAGES = {
  'email:confirm-sent': "Almost done! We've emailed you a link. Tap it to confirm your subscription.",
  'email:pending': "Thanks! You're on the list. We'll email you a link to confirm shortly.",
  'email:already': "You're already subscribed with this email.",
  'phone:subscribed': "Done! You'll get our daily rates and news on WhatsApp.",
  'phone:already': "You're already subscribed with this number.",
};

// POST /api/subscribe { contact }
router.post('/', async (req, res) => {
  const contact = updates.parseContact(req.body.contact);
  if (!contact) {
    return res.status(400).json({ error: 'Please enter a valid email address or a 10-digit mobile number.' });
  }
  if (tooMany(req.ip)) {
    return res.status(429).json({ error: 'Too many sign-ups from your connection. Please try again later.' });
  }
  try {
    const { kind, status } = await updates.subscribe(contact);
    res.json({ message: MESSAGES[`${kind}:${status}`] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not subscribe you right now. Please try again.' });
  }
});

// One-click unsubscribe (email clients' "Unsubscribe" button, and our page).
router.post('/unsubscribe', async (req, res) => {
  try {
    await updates.unsubscribe(req.query.token || req.body.token);
    if (req.accepts(['html', 'json']) === 'html') return res.redirect('/unsubscribe?done=1');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not unsubscribe. Please try again.' });
  }
});

// /api/subscribe/push… — notifications on this device, no login needed.
mountPushRoutes(router, (req, res, next) => next(), () => ({ updates: true }));

module.exports = router;
