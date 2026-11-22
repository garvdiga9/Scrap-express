// Complaints to the Grievance Officer. Each one gets a ticket number at once
// (that is the acknowledgement, shown on screen and emailed when an email is
// given); the target is to resolve it within RESOLVE_DAYS. The customer can
// check the status any time with the ticket number and their phone number.
const pool = require('../db/pool');
const mailer = require('./mailer');

const CATEGORIES = ['Pickup', 'Weighing', 'Payment', 'Rates or quote', 'Staff behaviour', 'Privacy or my data', 'Website or app', 'Other'];
const STATUSES = { open: 'Received', in_progress: 'Being looked into', resolved: 'Resolved', closed: 'Closed' };
const ACK_HOURS = 48;
const RESOLVE_DAYS = 7;
const MAX_MESSAGE = 2000;
const MAX_RESPONSE = 2000;

const TICKET_RE = /^GRV-\d{5,}$/;
const cleanTicket = (t) => String(t ?? '').trim().toUpperCase().replace(/\s+/g, '');

// What the customer may see about their own complaint.
const publicView = (g) => ({
  ticket: g.ticket,
  category: g.category,
  status: g.status,
  statusLabel: STATUSES[g.status] || g.status,
  response: g.response || '',
  createdAt: g.created_at,
  acknowledgedAt: g.acknowledged_at,
  resolvedAt: g.resolved_at,
  dueBy: new Date(new Date(g.created_at).getTime() + RESOLVE_DAYS * 86400e3),
});

async function create({
  name, phone, email, requestRef, category, message, customerId,
}) {
  const { rows: [g] } = await pool.query(
    `WITH n AS (SELECT nextval(pg_get_serial_sequence('grievances', 'id')) AS id)
     INSERT INTO grievances (id, ticket, name, phone, email, request_ref, category, message, customer_id, acknowledged_at)
     SELECT n.id, 'GRV-' || lpad(n.id::text, 5, '0'), $1, $2, $3, $4, $5, $6, $7, NOW() FROM n
     RETURNING *`,
    [name, phone, email || null, requestRef || null, category, message, customerId || null]
  );
  if (g.email && mailer.enabled) {
    const e = mailer.escapeHtml;
    mailer.send({
      to: g.email,
      subject: `We have received your complaint (${g.ticket})`,
      text: `Dear ${g.name},\n\nWe have received your complaint about "${g.category}". Your ticket number is ${g.ticket}.\nWe aim to resolve it within ${RESOLVE_DAYS} days. You can check its status at ${mailer.SITE_URL}/grievance/status with your ticket number and phone number.\n\nScrap Express`,
      html: mailer.layout(`<p>Dear ${e(g.name)},</p><p>We have received your complaint about <strong>${e(g.category)}</strong>.</p>
        <p style="font-size:20px;font-weight:bold">Ticket: ${e(g.ticket)}</p>
        <p>We aim to resolve it within ${RESOLVE_DAYS} days. You can check its status any time at
        <a href="${mailer.SITE_URL}/grievance/status">${mailer.SITE_URL}/grievance/status</a> with your ticket number and phone number.</p>`),
    }).catch((err) => console.error('complaint acknowledgement email failed', err.message));
  }
  return g;
}

// The ticket and the phone number must both match.
async function findForCustomer(ticket, phone) {
  const t = cleanTicket(ticket);
  if (!TICKET_RE.test(t) || !phone) return null;
  const { rows } = await pool.query('SELECT * FROM grievances WHERE ticket = $1 AND phone = $2', [t, phone]);
  return rows[0] ? publicView(rows[0]) : null;
}

async function list() {
  const { rows } = await pool.query(
    `SELECT *, created_at < NOW() - make_interval(days => $1) AND status IN ('open', 'in_progress') AS overdue
     FROM grievances ORDER BY (status IN ('open', 'in_progress')) DESC, created_at DESC LIMIT 500`,
    [RESOLVE_DAYS]
  );
  return rows;
}

async function update(id, { status, response }) {
  if (!STATUSES[status]) return { error: 'Please choose a status.' };
  const text = String(response ?? '').trim();
  if (text.length > MAX_RESPONSE) return { error: `Please keep the reply under ${MAX_RESPONSE} characters.` };
  if (['resolved', 'closed'].includes(status) && !text) return { error: 'Please write what was done before marking it resolved or closed. The customer sees this reply.' };
  const { rows: [g] } = await pool.query(
    `UPDATE grievances SET status = $1::varchar, response = NULLIF($2::text, ''), updated_at = NOW(),
       resolved_at = CASE WHEN $1::varchar IN ('resolved', 'closed') THEN COALESCE(resolved_at, NOW()) ELSE NULL END
     WHERE id = $3 RETURNING *`,
    [status, text, id]
  );
  return g ? { value: g } : { error: 'Not found' };
}

// For the admin to-do list.
async function counts() {
  const { rows: [c] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS open,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND created_at < NOW() - make_interval(days => $1))::int AS overdue,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND created_at < NOW() - make_interval(days => $2))::int AS soon
     FROM grievances`,
    [RESOLVE_DAYS, RESOLVE_DAYS - 2]
  );
  return c;
}

module.exports = {
  CATEGORIES, STATUSES, ACK_HOURS, RESOLVE_DAYS, MAX_MESSAGE, create, findForCustomer, list, update, counts, cleanTicket,
};
