// Sending email. Uses Gmail by default: SMTP_USER is the Gmail address and
// SMTP_PASS a Gmail "App Password" (not the normal password). Until both are
// set, email is simply switched off and everything else keeps working.
const nodemailer = require('nodemailer');

const { SITE_URL } = require('./site-url');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const user = process.env.SMTP_USER;
const enabled = Boolean(user && process.env.SMTP_PASS);

const transport = enabled
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass: process.env.SMTP_PASS },
    // Gmail allows ~500 messages a day; send gently.
    pool: true,
    maxConnections: 2,
    rateDelta: 1000,
    rateLimit: 4,
  })
  : null;

const { brandify, BRAND } = require('./brand');

async function send({ to, subject, html, text, headers }) {
  [subject, html, text] = [subject, html, text].map(brandify);
  if (!transport) throw new Error('Email is not set up');
  return transport.sendMail({
    from: `"${BRAND.name}" <${user}>`,
    to, subject, html, text, headers,
  });
}

// The look shared by all our emails. `footer` is extra HTML under the address.
function layout(bodyHtml, footer = '') {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold">
      ♻ Scrap <span style="color:#22c55e">Express</span></div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:24px">${bodyHtml}</div>
    <p style="font-size:12px;color:#64748b;text-align:center;line-height:1.6;margin:18px 0 0">
      Scrap Express · Bulk scrap buyers, Delhi NCR · +91 98188 26333${footer}</p>
  </div></body></html>`;
}

module.exports = {
  SITE_URL, enabled, send, escapeHtml, layout,
};
