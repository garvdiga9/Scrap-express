// Daily scrap rates & news for subscribers, by app/browser notification,
// email and WhatsApp. The rates go out automatically once a day (time set
// in the admin dashboard); announcements are sent by hand from the admin.
const crypto = require('crypto');
const pool = require('../db/pool');
const settings = require('./settings');
const push = require('./push');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const { EMAIL_RE } = require('./validation');

const SITE_URL = (process.env.SITE_URL || 'https://scrap-express.onrender.com').replace(/\/$/, '');
const DEFAULTS = { dailyEnabled: true, dailyTime: '09:00', whatsappChannelUrl: '' };
// A daily send that was missed (server asleep or restarting) still goes out
// if it's within this many hours of the set time, but never later.
const CATCH_UP_HOURS = 3;

async function getSettings() {
  return { ...DEFAULTS, ...(await settings.get('updates', {})) };
}

async function saveSettings(input) {
  const current = await getSettings();
  const next = {
    dailyEnabled: input.dailyEnabled === undefined ? current.dailyEnabled : Boolean(input.dailyEnabled),
    dailyTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyTime || '') ? input.dailyTime : current.dailyTime,
    whatsappChannelUrl: input.whatsappChannelUrl === undefined ? current.whatsappChannelUrl : String(input.whatsappChannelUrl).trim(),
  };
  if (next.whatsappChannelUrl && !/^https:\/\/(www\.)?whatsapp\.com\/channel\/[\w-]+$/.test(next.whatsappChannelUrl)) {
    throw Object.assign(new Error('The WhatsApp Channel link should look like https://whatsapp.com/channel/…'), { status: 400 });
  }
  await settings.set('updates', next);
  return next;
}

// ---- subscribers ----

// "name@company.com" → email; "98765 43210" / "+91 9876543210" → +919876543210
function parseContact(input) {
  const value = String(input || '').trim();
  if (EMAIL_RE.test(value)) return { email: value.toLowerCase().slice(0, 200) };
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return { phone: `+91${digits}` };
  return null;
}

const newToken = () => crypto.randomBytes(24).toString('hex');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailLayout(bodyHtml, token) {
  const unsubscribe = `${SITE_URL}/unsubscribe?token=${token}`;
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold">
      ♻ Scrap <span style="color:#22c55e">Express</span></div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:24px">${bodyHtml}</div>
    <p style="font-size:12px;color:#64748b;text-align:center;line-height:1.6;margin:18px 0 0">
      Scrap Express · Bulk scrap buyers, Delhi NCR · +91 98188 26333<br>
      <a href="${unsubscribe}" style="color:#64748b">Unsubscribe</a> from rate updates</p>
  </div></body></html>`;
}

function unsubscribeHeaders(token) {
  return {
    'List-Unsubscribe': `<${SITE_URL}/api/subscribe/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

async function sendConfirmation(sub) {
  const link = `${SITE_URL}/subscribe/confirm?token=${sub.token}`;
  await mailer.send({
    to: sub.email,
    subject: 'Confirm your Scrap Express rate updates',
    text: `Tap to confirm you'd like daily scrap rates and news from Scrap Express: ${link}\n\nDidn't ask for this? Just ignore this email.`,
    html: emailLayout(`<h2 style="margin:0 0 12px;font-size:20px">Confirm your subscription</h2>
      <p style="line-height:1.6">Tap the button to start getting <strong>daily scrap rates</strong> and news from Scrap Express.</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">Yes, send me updates</a></p>
      <p style="font-size:13px;color:#64748b">Didn't ask for this? Just ignore this email and nothing more will be sent.</p>`, sub.token),
  });
  await pool.query('UPDATE subscribers SET confirmation_sent_at = NOW() WHERE id = $1', [sub.id]);
}

// Returns { kind: 'email' | 'phone', status: 'confirm-sent' | 'pending' | 'subscribed' | 'already' }
async function subscribe(contact) {
  if (contact.email) {
    const { rows: [sub] } = await pool.query(
      `INSERT INTO subscribers (email, token) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING *`,
      [contact.email, newToken()]
    );
    if (sub.email_confirmed_at) return { kind: 'email', status: 'already' };
    // Don't re-send a confirmation more than once every 10 minutes.
    const recentlySent = sub.confirmation_sent_at && Date.now() - new Date(sub.confirmation_sent_at) < 10 * 60 * 1000;
    if (mailer.enabled && !recentlySent) {
      await sendConfirmation(sub);
      return { kind: 'email', status: 'confirm-sent' };
    }
    return { kind: 'email', status: mailer.enabled ? 'confirm-sent' : 'pending' };
  }
  const { rowCount } = await pool.query(
    'INSERT INTO subscribers (phone, token) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING',
    [contact.phone, newToken()]
  );
  return { kind: 'phone', status: rowCount ? 'subscribed' : 'already' };
}

async function confirm(token) {
  const { rows } = await pool.query(
    'UPDATE subscribers SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE token = $1 AND email IS NOT NULL RETURNING email',
    [String(token || '')]
  );
  return rows[0] || null;
}

async function unsubscribe(token) {
  const { rows } = await pool.query('DELETE FROM subscribers WHERE token = $1 RETURNING email, phone', [String(token || '')]);
  return rows[0] || null;
}

async function findByToken(token) {
  const { rows } = await pool.query('SELECT email, phone FROM subscribers WHERE token = $1', [String(token || '')]);
  return rows[0] || null;
}

// Emails that signed up before email sending was switched on still need
// their confirmation link.
async function sendPendingConfirmations() {
  if (!mailer.enabled) return;
  const { rows } = await pool.query(
    'SELECT * FROM subscribers WHERE email IS NOT NULL AND email_confirmed_at IS NULL AND confirmation_sent_at IS NULL LIMIT 100'
  );
  for (const sub of rows) {
    await sendConfirmation(sub).catch((err) => console.error('Confirmation email failed:', err.message));
  }
}

async function counts() {
  const { rows: [c] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE email IS NOT NULL AND email_confirmed_at IS NOT NULL) AS emails,
      COUNT(*) FILTER (WHERE email IS NOT NULL AND email_confirmed_at IS NULL) AS emails_pending,
      COUNT(*) FILTER (WHERE phone IS NOT NULL) AS phones,
      (SELECT COUNT(*) FROM push_subscriptions WHERE wants_updates) AS devices
    FROM subscribers`);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

async function list() {
  const { rows } = await pool.query(
    'SELECT id, email, phone, email_confirmed_at, created_at FROM subscribers ORDER BY created_at DESC LIMIT 1000'
  );
  return rows;
}

async function remove(id) {
  await pool.query('DELETE FROM subscribers WHERE id = $1', [id]);
}

// ---- sending ----

const fmtPrice = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Today's rates, each marked up/down against the rates last sent.
async function buildRatesDigest() {
  const { rows } = await pool.query('SELECT name, unit, price FROM scrap_categories ORDER BY sort_order ASC, name ASC');
  const before = await settings.get('rates_snapshot', {});
  const items = rows.map((r) => {
    const price = Number(r.price);
    const old = before[r.name];
    const change = old === undefined || old === price ? null : (price > old ? 'up' : 'down');
    return { name: r.name, unit: r.unit, price, change };
  });
  return { items, changed: items.filter((i) => i.change) };
}

const ARROW = { up: '▲', down: '▼' };
const itemText = (i) => `${i.name} ${fmtPrice(i.price)}/${i.unit}${i.change ? ` ${ARROW[i.change]}` : ''}`;

function shortRatesLine(digest, max) {
  // Changed rates first, then the rest, as many as fit.
  const ordered = [...digest.changed, ...digest.items.filter((i) => !i.change)];
  const parts = [];
  for (const item of ordered) {
    const next = [...parts, itemText(item)].join(' · ');
    if (next.length > max) break;
    parts.push(itemText(item));
  }
  return parts.join(' · ');
}

function ratesEmailHtml(digest, dateLabel) {
  const rows = digest.items.map((i) => {
    const color = i.change === 'up' ? '#15803d' : i.change === 'down' ? '#b91c1c' : '#94a3b8';
    return `<tr>
      <td style="padding:9px 0;border-top:1px solid #e2e8f0">${escapeHtml(i.name)}</td>
      <td style="padding:9px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:bold">${fmtPrice(i.price)} <span style="color:#64748b;font-weight:normal">/ ${escapeHtml(i.unit)}</span></td>
      <td style="padding:9px 0 9px 10px;border-top:1px solid #e2e8f0;color:${color};width:18px">${i.change ? ARROW[i.change] : '–'}</td>
    </tr>`;
  }).join('');
  const summary = digest.changed.length
    ? `${digest.changed.length} rate${digest.changed.length === 1 ? '' : 's'} changed since the last update.`
    : 'No changes since the last update.';
  return `<h2 style="margin:0 0 4px;font-size:20px">Today's scrap rates</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px">${escapeHtml(dateLabel)} · ${summary}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
    <p style="font-size:13px;color:#64748b;line-height:1.6;margin:18px 0">Indicative rates per unit. Business lots are priced on volume, grade and location. GST invoice, weighbridge slip and bank transfer on every pickup.</p>
    <p style="margin:0"><a href="${SITE_URL}/book-pickup" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">Request a Bulk Quote</a></p>`;
}

async function confirmedEmails() {
  const { rows } = await pool.query('SELECT email, token FROM subscribers WHERE email IS NOT NULL AND email_confirmed_at IS NOT NULL');
  return rows;
}
async function phones() {
  const { rows } = await pool.query('SELECT phone FROM subscribers WHERE phone IS NOT NULL');
  return rows;
}

// Sends to every channel that is switched on; one failure never stops the rest.
async function broadcast({ notification, email, whatsappKind, whatsappText }) {
  const result = { devices: 0, emails: 0, whatsapp: 0, failed: 0 };
  try {
    result.devices = await push.notifyUpdateSubscribers(notification);
  } catch (err) {
    result.failed += 1;
    console.error('Update push failed:', err.message);
  }
  if (mailer.enabled) {
    for (const sub of await confirmedEmails()) {
      try {
        await mailer.send({
          to: sub.email, subject: email.subject, text: email.text,
          html: emailLayout(email.html, sub.token), headers: unsubscribeHeaders(sub.token),
        });
        result.emails += 1;
      } catch (err) {
        result.failed += 1;
        console.error('Update email failed:', err.message);
      }
    }
  }
  if (whatsapp.enabled(whatsappKind)) {
    for (const { phone } of await phones()) {
      try {
        await whatsapp.sendTemplate(whatsappKind, phone, whatsappText);
        result.whatsapp += 1;
      } catch (err) {
        result.failed += 1;
        console.error(err.message);
      }
    }
  }
  return result;
}

const todayLabel = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

async function sendRates() {
  const digest = await buildRatesDigest();
  if (!digest.items.length) return { devices: 0, emails: 0, whatsapp: 0, failed: 0 };
  const date = todayLabel();
  const result = await broadcast({
    notification: {
      title: digest.changed.length ? "Today's scrap rates 📈 — prices changed" : "Today's scrap rates 📈",
      body: shortRatesLine(digest, 150),
      url: '/rates',
      tag: 'daily-rates',
    },
    email: {
      subject: `Today's scrap rates · ${date}`,
      text: `Today's scrap rates (${date}):\n${digest.items.map(itemText).join('\n')}\n\nFull list: ${SITE_URL}/rates`,
      html: ratesEmailHtml(digest, date),
    },
    whatsappKind: 'rates',
    whatsappText: `${shortRatesLine(digest, 700)}. Full list: ${SITE_URL}/rates`,
  });
  // Remember what was sent, so tomorrow's update can show what changed.
  await settings.set('rates_snapshot', Object.fromEntries(digest.items.map((i) => [i.name, i.price])));
  return result;
}

async function sendAnnouncement({ title, message }) {
  const safeTitle = String(title || '').trim().slice(0, 80);
  const safeMessage = String(message || '').trim().slice(0, 600);
  if (!safeTitle || !safeMessage) throw Object.assign(new Error('Please add a title and a message.'), { status: 400 });
  return broadcast({
    notification: { title: safeTitle, body: safeMessage.slice(0, 180), url: '/', tag: 'announcement' },
    email: {
      subject: safeTitle,
      text: `${safeMessage}\n\n${SITE_URL}`,
      html: `<h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(safeTitle)}</h2>
        <p style="line-height:1.7;white-space:pre-line">${escapeHtml(safeMessage)}</p>
        <p style="margin:22px 0 0"><a href="${SITE_URL}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">Visit Scrap Express</a></p>`,
    },
    whatsappKind: 'news',
    whatsappText: `${safeTitle}: ${safeMessage}`,
  });
}

// ---- daily schedule ----

function nowInIndia() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

async function tick() {
  const cfg = await getSettings();
  if (!cfg.dailyEnabled) return;
  const [h, m] = cfg.dailyTime.split(':').map(Number);
  const { date, minutes } = nowInIndia();
  const due = minutes >= h * 60 + m && minutes < h * 60 + m + CATCH_UP_HOURS * 60;
  // claim() lets exactly one run per day through, even across restarts.
  if (!due || !(await settings.claim('updates_last_daily', date))) return;
  const result = await sendRates();
  console.log(`Daily rates sent: ${JSON.stringify(result)}`);
}

function startSchedule() {
  const run = () => tick().catch((err) => console.error('Daily rates job failed:', err.message));
  setTimeout(run, 20 * 1000);
  setInterval(run, 60 * 1000);
  sendPendingConfirmations().catch((err) => console.error(err.message));
}

module.exports = {
  getSettings, saveSettings, parseContact, subscribe, confirm, unsubscribe, findByToken,
  counts, list, remove, sendRates, sendAnnouncement, startSchedule,
  channels: () => ({ email: mailer.enabled, whatsappRates: whatsapp.enabled('rates'), whatsappNews: whatsapp.enabled('news') }),
};
