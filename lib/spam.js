// Keeping bots off the public forms (booking, demolition, call back,
// subscribe, lot enquiries) without bothering real visitors:
//  - limit(): how many times one connection may send a form per hour
//  - honeypot(): every form has a hidden "website" box (as on the call-back and lot forms) that people never
//    see or fill in. Bots fill in every box; when it's filled, the request
//    gets a normal-looking "thank you" but nothing is saved or alerted.
const HONEYPOT_FIELD = 'website';
const HOUR = 60 * 60 * 1000;
const hits = new Map(); // `${name}:${ip}` -> [times]

// The tests run many bookings from one computer: limits only apply there
// when a test asks for them.
const limitsOff = (req) => process.env.NODE_ENV === 'test' && req.get('x-test-rate-limit') !== 'on';

function limit(name, { max, windowMs = HOUR, message }) {
  return (req, res, next) => {
    if (limitsOff(req)) return next();
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const times = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (times.length >= max) {
      const wait = Math.ceil((times[0] + windowMs - now) / 60000);
      res.set('Retry-After', String(wait * 60));
      return res.status(429).json({
        error: message || `Too many tries from your connection. Please try again in ${wait} minute${wait === 1 ? '' : 's'}, or call us on +91 98188 26333.`,
      });
    }
    times.push(now);
    hits.set(key, times);
    if (hits.size > 20000) hits.clear(); // a flood of addresses: start over
    return next();
  };
}

// reply(req, res): what a "successful" request normally answers.
function honeypot(reply = (req, res) => res.status(201).json({ message: 'Thank you! We will be in touch.' })) {
  return (req, res, next) => {
    const trap = req.body && req.body[HONEYPOT_FIELD];
    if (trap && String(trap).trim()) {
      console.warn(`Spam blocked (hidden field filled) on ${req.originalUrl} from ${req.ip}`);
      return reply(req, res);
    }
    return next();
  };
}

module.exports = { limit, honeypot, HONEYPOT_FIELD };
