// Sending email. Uses Gmail by default: SMTP_USER is the Gmail address and
// SMTP_PASS a Gmail "App Password" (not the normal password). Until both are
// set, email is simply switched off and everything else keeps working.
const nodemailer = require('nodemailer');

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

async function send({ to, subject, html, text, headers }) {
  if (!transport) throw new Error('Email is not set up');
  return transport.sendMail({
    from: `"Scrap Express" <${user}>`,
    to, subject, html, text, headers,
  });
}

module.exports = { enabled, send };
