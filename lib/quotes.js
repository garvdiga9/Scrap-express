// The private link on every quote, so customers without an account can see and
// answer it: /quote/<token>. The token is long and random, so the link can't be
// guessed; whoever has it can answer that one quote and nothing else.
const crypto = require('crypto');
const pool = require('../db/pool');
const mailer = require('./mailer');
const push = require('./push');
const { formatQuoteRate, readyDateRange } = require('../data/business');

const TOKEN_RE = /^[a-f0-9]{48}$/;
const EMAIL_WAIT_MS = 8000;

const newToken = () => crypto.randomBytes(24).toString('hex');
const quoteUrl = (token) => `${mailer.SITE_URL}/quote/${token}`;

// Quotes sent before links existed get one too, so they can be shared.
async function addMissingTokens() {
  const { rows } = await pool.query('SELECT id FROM pickup_requests WHERE quote_items IS NOT NULL AND quote_token IS NULL');
  for (const { id } of rows) {
    await pool.query('UPDATE pickup_requests SET quote_token = $1 WHERE id = $2', [newToken(), id]);
  }
}

async function findByToken(token) {
  if (!TOKEN_RE.test(token || '')) return null;
  const { rows } = await pool.query(
    `SELECT id, created_at, status, company_name, scrap_type, approx_quantity, item_quantities, area,
            quote_items, quote_note, quoted_at, quote_response, quote_responded_at, ready_date, cancelled_by, rating, rating_comment, rated_at
     FROM pickup_requests WHERE quote_token = $1 AND quote_items IS NOT NULL`,
    [token]
  );
  return rows[0] || null;
}

// Only a quote still waiting can be answered, so an old link can't overwrite a revision.
async function respond(token, response) {
  if (!TOKEN_RE.test(token || '')) return null;
  const { rows } = await pool.query(
    `UPDATE pickup_requests
     SET status = $2, quote_response = $2, quote_responded_at = NOW()
     WHERE quote_token = $1 AND status = 'quoted'
     RETURNING id, company_name, name, customer_id, quote_token`,
    [token, response]
  );
  return rows[0] || null;
}

async function markReady(token, readyDate) {
  if (!TOKEN_RE.test(token || '')) return null;
  const { rows } = await pool.query(
    `UPDATE pickup_requests
     SET status = 'ready', ready_at = NOW(), ready_date = $2
     WHERE quote_token = $1 AND status = 'accepted'
     RETURNING id, company_name, name, customer_id, quote_token`,
    [token, readyDate]
  );
  return rows[0] || null;
}

function validReadyDate(readyDate) {
  const { min, max } = readyDateRange();
  // Dates in this format sort correctly as plain text.
  return /^\d{4}-\d{2}-\d{2}$/.test(readyDate || '') && readyDate >= min && readyDate <= max;
}

function notifyAnswer(row, response) {
  push.quietly(push.notifyAdmins({
    title: response === 'accepted' ? `Quote accepted ✅ #${row.id}` : `Quote declined #${row.id}`,
    body: response === 'accepted'
      ? `${row.company_name || row.name} accepted your quote. Call them to schedule the pickup.`
      : `${row.company_name || row.name} declined your quote.`,
    url: `/admin.html#pickup-${row.id}`,
    tag: `pickup-${row.id}`,
  }));
}

function notifyReady(row, readyDate) {
  push.quietly(push.notifyAdmins({
    title: `Scrap ready 🚚 #${row.id}`,
    body: `${row.company_name || row.name} says the scrap is ready from ${readyDate}. Call them before sending a truck.`,
    url: `/admin.html#pickup-${row.id}`,
    tag: `pickup-${row.id}`,
  }));
}

// Emails the quote with its link. Returns 'sent', 'failed', 'off' (email isn't
// set up) or 'none' (no address given), for the admin to see.
async function emailQuote(row) {
  if (!row.email) return 'none';
  if (!mailer.enabled) return 'off';
  const { escapeHtml } = mailer;
  const link = quoteUrl(row.quote_token);
  const lines = row.quote_items.map((item) => `${item.material}: ${formatQuoteRate(item)}`);
  const rows = row.quote_items.map((item) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0">${escapeHtml(item.material)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold">${escapeHtml(formatQuoteRate(item))}</td>
    </tr>`).join('');
  const sending = mailer.send({
    to: row.email,
    subject: `Your Scrap Express quote for request #${row.id}`,
    text: [
      `Hello ${row.name},`, '',
      `Here is our quote for your pickup request #${row.id}:`,
      ...lines,
      ...(row.quote_note ? ['', row.quote_note] : []), '',
      'The final amount is worked out from the weighbridge weight at pickup.', '',
      `Accept or decline it here: ${link}`,
    ].join('\n'),
    html: mailer.layout(`<h2 style="margin:0 0 12px;font-size:20px">Your quote is ready</h2>
      <p style="line-height:1.6">Hello ${escapeHtml(row.name)}, here is our quote for your pickup request <strong>#${row.id}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
      ${row.quote_note ? `<p style="line-height:1.6;margin:16px 0 0">${escapeHtml(row.quote_note)}</p>` : ''}
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:16px 0">The final amount is worked out from the weighbridge weight at pickup. Payment by cash or bank transfer, whichever you prefer.</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">View &amp; Answer This Quote</a></p>
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0">This link is private to your request, so please don't share it. No login needed.</p>`),
  });
  // Don't keep the admin waiting on a slow mail server.
  const giveUp = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('timed out')), EMAIL_WAIT_MS).unref();
  });
  try {
    await Promise.race([sending, giveUp]);
    return 'sent';
  } catch (err) {
    console.error('Quote email failed:', err.message);
    return 'failed';
  }
}

module.exports = {
  newToken, addMissingTokens, findByToken, respond, markReady, validReadyDate, notifyAnswer, notifyReady, emailQuote,
};
