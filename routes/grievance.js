// Public complaint pages (plain forms, so they work without JavaScript):
//   GET/POST /grievance          the Grievance Officer page and complaint form
//   GET/POST /grievance/status   check a complaint with its ticket and phone
//   GET /legal/stamping-certificate  the scale's Legal Metrology certificate
const express = require('express');
const path = require('path');
const spam = require('../lib/spam');
const grievances = require('../lib/grievances');
const legal = require('../lib/legal');
const mailer = require('../lib/mailer');
const push = require('../lib/push');
const live = require('../lib/live');
const { PHONE_ERROR, EMAIL_ERROR, cleanPhone, cleanEmail } = require('../lib/validation');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '20kb' });

const pageInfo = {
  page: 'grievance',
  title: 'Grievance Officer and Complaints - Scrap Express',
  description: 'Complaints about a pickup, payment, our staff or your data: contact our Grievance Officer. Ticket number at once, resolved within 7 days.',
  categories: grievances.CATEGORIES,
  maxMessage: grievances.MAX_MESSAGE,
  ackHours: grievances.ACK_HOURS,
  resolveDays: grievances.RESOLVE_DAYS,
  mailEnabled: mailer.enabled,
};
const statusInfo = {
  page: 'grievance', noindex: true, title: 'Complaint Status - Scrap Express', description: 'Check the status of your complaint with its ticket number.',
};

router.get('/grievance', (req, res) => res.render('grievance', pageInfo));

router.post('/grievance', form, spam.limit('grievance', { max: 5 }), async (req, res, next) => {
  const again = (status, error) => res.status(status).render('grievance', { ...pageInfo, error, form: req.body });
  // Bots fill in the hidden field: they're told it worked, and nothing is saved.
  if (String(req.body.website || '').trim()) return res.status(201).render('grievance', { ...pageInfo, done: { ticket: 'GRV-00000' } });

  const name = String(req.body.name ?? '').trim().slice(0, 150);
  const message = String(req.body.message ?? '').trim();
  const requestRef = String(req.body.requestRef ?? '').trim().slice(0, 50);
  if (!name || !req.body.phone || !message) return again(400, 'Please fill in your name, phone number and complaint.');
  const phone = cleanPhone(req.body.phone);
  if (!phone) return again(400, PHONE_ERROR);
  const typedEmail = String(req.body.email ?? '').trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) return again(400, EMAIL_ERROR);
  if (!grievances.CATEGORIES.includes(req.body.category)) return again(400, 'Please choose what your complaint is about.');
  if (message.length > grievances.MAX_MESSAGE) return again(400, `Please keep your complaint under ${grievances.MAX_MESSAGE} characters.`);
  try {
    const g = await grievances.create({
      name, phone, email, requestRef, category: req.body.category, message, customerId: req.session && req.session.customerId,
    });
    res.status(201).render('grievance', { ...pageInfo, done: { ticket: g.ticket } });
    live.publish('grievances');
    push.quietly(push.notifyAdmins({
      title: `Complaint ${g.ticket} ⚠ ${g.category}`,
      body: `${g.name}: ${g.message.slice(0, 100)}`,
      url: '/admin.html#tab-grievances',
      tag: `grievance-${g.id}`,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/grievance/status', (req, res) => res.render('grievance-status', statusInfo));

router.post('/grievance/status', form, spam.limit('grievance-status', { max: 30 }), async (req, res, next) => {
  const ticket = grievances.cleanTicket(req.body.ticket);
  const phone = cleanPhone(req.body.phone);
  const shown = { ticket, phone: req.body.phone };
  try {
    const result = phone ? await grievances.findForCustomer(ticket, phone) : null;
    if (!result) {
      return res.status(404).render('grievance-status', {
        ...statusInfo, form: shown, error: "We couldn't find a complaint with that ticket number and phone number. Please check both.",
      });
    }
    res.render('grievance-status', { ...statusInfo, form: shown, result });
  } catch (err) {
    next(err);
  }
});

router.get('/legal/stamping-certificate', async (req, res, next) => {
  try {
    const { certificate } = await legal.get();
    if (!certificate) return next();
    res.set('Cache-Control', 'no-cache');
    res.type(certificate.mime || 'application/octet-stream');
    res.sendFile(path.join(legal.DOCS_DIR(), path.basename(certificate.fileName)), (err) => { if (err && !res.headersSent) next(); });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
