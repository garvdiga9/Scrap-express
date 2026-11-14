// Telling a customer about their pickup on every channel we have, so people
// without the app still hear: the app (push), email (once SMTP_USER /
// SMTP_PASS are set on Render) and automatic WhatsApp (once Meta's WhatsApp
// Cloud API and an approved "pickup" template are set: WHATSAPP_TOKEN,
// WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_PICKUP_TEMPLATE). Any channel that isn't
// set up is simply skipped. Each message carries the private request link.
const pool = require('../db/pool');
const push = require('./push');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const board = require('./board');

const linkFor = (token) => (token ? `${mailer.SITE_URL}/quote/${token}` : `${mailer.SITE_URL}/account`);

// Mobile numbers only, as 91XXXXXXXXXX (WhatsApp can't reach landlines).
const waNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
};

// The yard address and contact person, as one sentence or two.
function yardText(yard) {
  const y = yard || {};
  const parts = [y.address ? `Our yard: ${y.address}${y.hours ? ` (open ${y.hours})` : ''}.` : 'We will send you the yard address on WhatsApp.'];
  parts.push(y.pocPhone ? `Contact person: ${y.pocName || 'yard'}, +91 ${y.pocPhone}.` : 'Contact: +91 98188 26333.');
  if (y.map) parts.push(`Map: ${y.map}`);
  return parts.join(' ');
}

// What each step says, as one short message for every channel.
// r: the request row (with staff_name, slot label, amounts where known).
const MESSAGES = {
  slots_sent: (r) => (r.delivery_mode === 'self' ? {
    subject: `Choose when to bring your scrap (request #${r.id})`,
    text: `Please choose when you'll bring the scrap for request #${r.id} to our yard${r.deadlineText ? `, by ${r.deadlineText}` : ''}.`,
    button: 'Choose a Time',
  } : {
    subject: `Choose your pickup slot for request #${r.id}`,
    text: `Please choose a pickup slot for your request #${r.id}${r.deadlineText ? ` by ${r.deadlineText}` : ''}.`,
    button: 'Choose a Slot',
  }),
  scheduled: (r) => (r.delivery_mode === 'self' ? {
    subject: `Drop-off booked: ${r.slotText}`,
    text: `Please bring the scrap for request #${r.id} to our yard on ${r.slotText}. ${yardText(r.yard)}`,
    button: 'See Your Drop-off',
  } : {
    subject: `Pickup booked: ${r.slotText}`,
    text: `Your pickup #${r.id} is booked for ${r.slotText}. We'll tell you when our team sets off.`,
    button: 'See Your Pickup',
  }),
  // A drop-off was accepted: where to bring it and who to call.
  drop_info: (r) => (r.delivery_mode === 'self' ? {
    subject: `Where to bring your scrap (request #${r.id})`,
    text: `Thank you for accepting our quote for request #${r.id}. ${yardText(r.yard)} We'll send you times to choose from shortly.`,
    button: 'See the Details',
  } : null),
  // Reminders (lib/reminders.js).
  slots_reminder: (r) => ({
    subject: `Reminder: choose a time for request #${r.id}`,
    text: `Please choose ${r.delivery_mode === 'self' ? 'when you will bring the scrap' : 'your pickup time'} for request #${r.id}${r.deadlineText ? ` by ${r.deadlineText} today` : ''}, or tell us if none of the times work.`,
    button: 'Choose a Time',
  }),
  quote_reminder: (r) => ({
    subject: `Your quote for request #${r.id} is waiting`,
    text: `Our quote for request #${r.id} is waiting for your answer. Please accept or decline it, or call us on +91 98188 26333 with any questions.`,
    button: 'See Your Quote',
  }),
  // Drop-offs only: the scrap reached our yard.
  arrived: (r) => (r.delivery_mode === 'self' ? {
    subject: `Your scrap reached our yard (#${r.id})`,
    text: `Your scrap for request #${r.id} has reached our yard. We'll weigh it shortly and send you the receipt.`,
    button: 'Follow Your Drop-off',
  } : null),
  on_way: (r) => ({
    subject: `Our team is on the way (pickup #${r.id})`,
    text: `${r.staff_name ? `${r.staff_name.split(' ')[0]} from our team` : 'Our team'} has left for your site for pickup #${r.id}.`,
    button: 'Follow Your Pickup',
  }),
  weighed: (r) => ({
    subject: `Your scrap is weighed (pickup #${r.id})`,
    text: `Pickup #${r.id}: ${Number(r.weighed_kg).toLocaleString('en-IN')} kg weighed${r.amount_due != null ? `, amount ₹${Number(r.amount_due).toLocaleString('en-IN')}` : ''}. The receipt and the weighing photo are on your request page.`,
    button: 'See the Receipt',
  }),
  completed: (r) => ({
    subject: `Pickup #${r.id} complete`,
    text: r.payment_method === 'bank'
      ? `Pickup #${r.id} is complete. We'll transfer ₹${Number(r.amount_paid).toLocaleString('en-IN')} to your bank and let you know.`
      : `Pickup #${r.id} is complete and ₹${Number(r.amount_paid).toLocaleString('en-IN')} was paid in cash. Thank you! Please rate your pickup on your request page.`,
    button: 'See the Receipt',
  }),
  bank_paid: (r) => ({
    subject: `Payment sent for pickup #${r.id}`,
    text: `₹${Number(r.amount_paid).toLocaleString('en-IN')} for pickup #${r.id} has been transferred to your bank (ref. ${r.bank_reference}).`,
    button: 'See the Receipt',
  }),
  no_scrap: (r) => (r.delivery_mode === 'self' ? {
    subject: `Drop-off #${r.id} not accepted`,
    text: `We could not accept the scrap for request #${r.id}. Please call us on +91 98188 26333.`,
    button: 'See Your Request',
  } : {
    subject: `We couldn't collect pickup #${r.id}`,
    text: `Our team visited for pickup #${r.id} but could not collect the scrap. Please call us on +91 98188 26333.`,
    button: 'See Your Request',
  }),
  cancelled: (r) => ({
    subject: `Pickup #${r.id} cancelled`,
    text: `Pickup #${r.id} has been cancelled. Call us on +91 98188 26333 if this is unexpected.`,
    button: 'See Your Request',
  }),
};

// The message a person can send by hand on WhatsApp (the admin's button),
// for when automatic WhatsApp isn't set up.
function manualText(kind, r) {
  const message = MESSAGES[kind] && MESSAGES[kind](r);
  if (!message) return null;
  return `Hello ${r.name}, Scrap Express here. ${message.text} ${linkFor(r.quote_token)}`;
}

async function loadRequest(requestId) {
  const { rows } = await pool.query(
    `SELECT p.*, u.name AS staff_name, s.slot_date, s.time_from, s.time_to
     FROM pickup_requests p LEFT JOIN staff_users u ON u.id = p.staff_id LEFT JOIN pickup_slots s ON s.id = p.slot_id
     WHERE p.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

// Send `kind` for this request on every channel that's set up. The app alert
// is sent by the caller where it already was; this adds email and WhatsApp.
async function customer(kind, requestId, extra = {}) {
  const r = await loadRequest(requestId);
  if (!r) return;
  if (r.delivery_mode === 'self') r.yard = await board.yard();
  Object.assign(r, extra);
  const message = MESSAGES[kind] && MESSAGES[kind](r);
  if (!message) return;
  const link = linkFor(r.quote_token);
  const jobs = [];
  if (r.email && mailer.enabled) {
    jobs.push(mailer.send({
      to: r.email,
      subject: message.subject,
      text: `Hello ${r.name},\n\n${message.text}\n\n${link}`,
      html: mailer.layout(`<p style="line-height:1.6;margin:0 0 6px">Hello ${mailer.escapeHtml(r.name)},</p>
        <p style="line-height:1.6;font-size:16px">${mailer.escapeHtml(message.text)}</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">${message.button}</a></p>
        <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0">This link is private to your request, so please don't share it.</p>`),
    }).catch((err) => console.error(`Email (${kind}) failed:`, err.message)));
  }
  // Phones following this request from its private link (no account).
  jobs.push(push.notifyToken(r.quote_token, {
    title: message.subject, body: message.text, url: `/quote/${r.quote_token}`, tag: `pickup-${r.id}`,
  }, r.customer_id).catch((err) => console.error(`Push (${kind}) failed:`, err.message)));
  const number = waNumber(r.phone);
  if (number && whatsapp.enabled('pickup')) {
    jobs.push(whatsapp.sendTemplate('pickup', number, `${message.text} ${link}`)
      .catch((err) => console.error(`WhatsApp (${kind}) failed:`, err.message)));
  }
  await Promise.all(jobs);
}

// Fire and forget: a slow mail server never holds up the person who acted.
const quietly = (kind, requestId, extra) => { customer(kind, requestId, extra).catch((err) => console.error('notify', err)); };

const channels = () => ({ email: mailer.enabled, whatsapp: whatsapp.enabled('pickup') });

module.exports = {
  customer, quietly, manualText, channels, MESSAGES,
};
