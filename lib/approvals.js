// Owner approval for a manager's important changes: scrap rates, staff
// logins, lots for sale, the home page numbers and the yard address.
//
// A route wraps its handler with approval(kind, handler). When the owner
// sends the request, the handler runs as usual. When a manager sends it, the
// request is stored (with a plain description of what would change, before →
// after) and the owner is alerted; nothing goes live. On approval the stored
// request is run through the very same handler, as the owner; on rejection
// it is dropped. Either way the manager is told.
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const push = require('./push');
const live = require('./live');
const { roleOf } = require('../middleware/auth');

const kinds = new Map(); // kind → { label, describe, handler }

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const clip = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
const changes = (before, after, fields) => fields
  .filter(([key]) => after[key] !== undefined && after[key] !== null && String(after[key]) !== String(before ? before[key] ?? '' : ''))
  .map(([key, label, fmt = (v) => clip(v)]) => `${label}: ${before && before[key] != null && before[key] !== '' ? `${fmt(before[key])} → ` : ''}${fmt(after[key])}`);

// What the owner sees for each kind: { summary, details: [lines] }.
const DESCRIBE = {
  'rate.add': async ({ body }) => ({
    summary: `Add a new rate: ${clip(body.name, 60)} at ${inr(body.price)} per ${clip(body.unit || 'kg', 20)}`,
    details: [`Name: ${clip(body.name)}`, `Price: ${inr(body.price)} per ${clip(body.unit || 'kg', 20)}`, `Group: ${clip(body.category || 'other', 30)}`],
  }),
  'rate.change': async ({ params, body }) => {
    const before = await one('SELECT name, unit, price, category FROM scrap_categories WHERE id = $1', [params.id]);
    const lines = changes(before, body, [['name', 'Name'], ['price', 'Price', inr], ['unit', 'Unit'], ['category', 'Group']]);
    return {
      summary: `Change the rate for ${clip(before ? before.name : `#${params.id}`, 60)}${body.price != null && before ? `: ${inr(before.price)} → ${inr(body.price)}` : ''}`,
      details: lines.length ? lines : ['No visible change'],
    };
  },
  'staff.add': async ({ body }) => ({
    summary: `Add a staff login: ${clip(body.name, 60)} (username ${clip(body.username, 40)})`,
    details: [`Name: ${clip(body.name)}`, `Username: ${clip(body.username)}`, ...(body.phone ? [`Phone: ${clip(body.phone, 20)}`] : []), 'Password: set by the manager'],
  }),
  'staff.change': async ({ params, body }) => {
    const before = await one('SELECT name, username, phone, active FROM staff_users WHERE id = $1', [params.id]);
    const lines = changes(before, body, [['name', 'Name'], ['username', 'Username'], ['phone', 'Phone'], ['active', 'Can log in', (v) => (v ? 'yes' : 'no')]]);
    if (body.passwordHash) lines.push('Password: reset by the manager');
    return { summary: `Change the staff login of ${clip(before ? before.name : `#${params.id}`, 60)}`, details: lines.length ? lines : ['No visible change'] };
  },
  'lot.add': async ({ body }) => ({
    summary: `Add a lot for sale: ${clip(body.title, 80)}`,
    details: Object.entries(body).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${clip(v, 100)}`).slice(0, 12),
  }),
  'lot.change': async ({ params, body }) => {
    const before = await one('SELECT * FROM sale_lots WHERE id = $1', [params.id]);
    const fields = Object.keys(body).filter((k) => typeof body[k] !== 'object').map((k) => [k, k]);
    const lines = changes(before, body, fields);
    return { summary: `Change the lot for sale ${clip(before ? before.title : `#${params.id}`, 80)}`, details: lines.length ? lines : ['No visible change'] };
  },
  'stats.change': async ({ body }) => {
    const before = await require('./site-stats').getStats().catch(() => ({}));
    const fields = Object.keys(body).filter((k) => typeof body[k] !== 'object').map((k) => [k, k]);
    const lines = changes(before, body, fields);
    return { summary: 'Change the home page numbers', details: lines.length ? lines : ['No visible change'] };
  },
  'yard.change': async ({ body }) => {
    const before = await require('./board').yard().catch(() => ({}));
    const lines = changes(before, body, [['address', 'Address'], ['hours', 'Hours'], ['map', 'Map link'], ['pocName', 'Contact person'], ['pocPhone', 'Contact phone']]);
    return { summary: 'Change the yard address shown to drop-off customers', details: lines.length ? lines : ['No visible change'] };
  },
};

// Passwords are never stored: a staff password is turned into its hash
// before the request waits for approval.
async function prepare(kind, body) {
  const out = { ...body };
  delete out.passwordHash;
  if (kind === 'staff.add' && !out.password) return { error: 'The password needs at least 6 characters.' };
  if (kind.startsWith('staff.') && out.password) {
    const password = String(out.password);
    if (password.length < 6) return { error: 'The password needs at least 6 characters.' };
    out.passwordHash = await bcrypt.hash(password, 10);
  }
  delete out.password;
  return { body: out };
}

// The same basic checks the routes make, so a manager hears about a mistake
// at once instead of the owner approving something that then fails.
const badPrice = (p) => p === '' || p == null || Number.isNaN(Number(p)) || Number(p) < 0;
const staffCheck = (b) => {
  if (!String(b.name ?? '').trim()) return "Please enter the staff member's name.";
  if (!/^[a-z0-9._-]{3,50}$/.test(String(b.username ?? '').trim().toLowerCase())) return 'The username needs 3 or more letters or numbers, with no spaces.';
  return null;
};
const VALIDATE = {
  'rate.add': (b) => (!b.name || badPrice(b.price) ? 'Name and a valid price are required' : null),
  'rate.change': (b) => (b.price != null && badPrice(b.price) ? 'Please enter a valid price.' : null),
  'lot.add': (b) => require('./lots').parseLot(b).error || null,
  'lot.change': (b) => require('./lots').parseLot(b).error || null,
  'staff.add': staffCheck,
  'staff.change': staffCheck,
};

function approval(kind, handler) {
  kinds.set(kind, { handler });
  return async (req, res) => {
    // Only stored requests may carry a ready-made password hash.
    if (req.body) delete req.body.passwordHash;
    if (roleOf(req) !== 'manager') return handler(req, res);
    try {
      const prepared = await prepare(kind, req.body || {});
      if (prepared.error) return res.status(400).json({ error: prepared.error });
      const invalid = VALIDATE[kind] && VALIDATE[kind](prepared.body);
      if (invalid) return res.status(400).json({ error: invalid });
      const params = { ...req.params };
      const { summary, details } = await DESCRIBE[kind]({ params, body: prepared.body });
      const who = req.session.adminName || 'A manager';
      const { rows: [row] } = await pool.query(
        `INSERT INTO pending_changes (kind, params, body, summary, details, requested_by_id, requested_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [kind, JSON.stringify(params), JSON.stringify(prepared.body), summary.slice(0, 300), JSON.stringify(details), req.session.adminId || null, who]
      );
      res.status(202).json({ pending: true, id: row.id, message: 'Sent to the owner for approval. It goes live once the owner approves it.' });
      live.publish('approvals');
      push.quietly(push.notifyOwner({
        title: `Approval needed ✋ ${who}`,
        body: summary,
        url: '/admin.html#tab-approvals',
        tag: `approval-${row.id}`,
      }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not send this for approval. Please try again.' });
    }
  };
}

// A reply catcher for running a stored request through its handler.
function captureReply() {
  const res = { statusCode: 200, data: null, headersSent: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; res.headersSent = true; return res; };
  res.send = res.json;
  res.set = () => res;
  return res;
}

async function decide(id, approve, owner, note) {
  const { rows: [p] } = await pool.query("SELECT * FROM pending_changes WHERE id = $1 AND status = 'pending'", [id]);
  if (!p) return { error: 'This change was already decided, or no longer exists.' };
  let status = approve ? 'approved' : 'rejected';
  let decisionNote = clip(note, 300) || null;
  if (approve) {
    const entry = kinds.get(p.kind);
    if (!entry) return { error: 'This kind of change can no longer be approved.' };
    const req = {
      params: p.params, body: p.body, query: {}, method: 'POST', path: '',
      session: { isAdmin: true, adminRole: 'owner', adminId: owner.id, adminName: owner.name },
    };
    const res = captureReply();
    await entry.handler(req, res);
    if (res.statusCode >= 400) {
      status = 'failed';
      decisionNote = (res.data && res.data.error) || 'It could not be applied.';
    }
  }
  await pool.query(
    'UPDATE pending_changes SET status = $1, decided_by_name = $2, decided_at = NOW(), decision_note = $3 WHERE id = $4',
    [status, owner.name, decisionNote, id]
  );
  live.publish('approvals');
  const word = { approved: 'approved ✅', rejected: 'rejected ❌', failed: 'could not be applied ⚠️' }[status];
  push.quietly(push.notifyAdminUser(p.requested_by_id, {
    title: `Your change was ${word}`,
    body: `${p.summary}${decisionNote ? ` · ${decisionNote}` : ''}`,
    url: '/admin.html#tab-approvals',
    tag: `approval-${p.id}`,
  }));
  return { value: { id: p.id, status, note: decisionNote, summary: p.summary } };
}

// Managers see their own requests; the owner sees everyone's.
async function list({ adminId, owner }) {
  const { rows } = await pool.query(
    `SELECT id, kind, summary, details, requested_by_name, status, decided_by_name, decided_at, decision_note, created_at
     FROM pending_changes WHERE ($1::boolean OR requested_by_id = $2)
     ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`,
    [Boolean(owner), adminId || null]
  );
  return rows;
}

async function pendingCount() {
  const { rows: [r] } = await pool.query("SELECT COUNT(*)::int AS n FROM pending_changes WHERE status = 'pending'");
  return r.n;
}

module.exports = {
  approval, decide, list, pendingCount, DESCRIBE,
};
