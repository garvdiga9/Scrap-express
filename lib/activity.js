// The activity log: who did what in the admin dashboard. Every change that
// succeeds (anything but a plain read) is written down with the person's
// name, so with several logins you can see who changed a status, sent a
// quote, gave cash or deleted something. Only the owner can read it.
const pool = require('../db/pool');

const KEEP_DAYS = 365;

// What the first part of the address is about.
const NOUNS = {
  requests: 'pickup request',
  demolition: 'demolition request',
  leads: 'unfinished pickup form',
  callbacks: 'call back',
  subscribers: 'subscriber',
  rates: 'rate',
  stats: 'home page numbers',
  testimonials: 'review',
  staff: 'staff member',
  team: 'team login',
  images: 'site photo',
  documents: 'paper',
  lots: 'sale lot',
  'lot-enquiries': 'lot enquiry',
  ratings: 'customer rating',
};
const VERBS = {
  POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted',
};
// Special actions, by the address with numbers taken out.
const ACTIONS = {
  'PUT /requests/:id/quote': 'Sent a quote for pickup',
  'POST /requests/:id/slots': 'Sent pickup slots for pickup',
  'PUT /requests/:id/staff': 'Assigned staff to pickup',
  'POST /requests/:id/bank-paid': 'Marked bank transfer done for pickup',
  'POST /ratings/:id/publish': 'Published a rating as a review, pickup',
  'PUT /requests/:id/outside': 'Sent an outside truck for pickup',
  'POST /requests/:id/book-slot': 'Booked a pickup time for the customer, pickup',
  'POST /requests/:id/office/step': 'Office marked a step on pickup',
  'POST /requests/:id/office/weigh': 'Office entered the weighing for pickup',
  'POST /requests/:id/office/paid': 'Office marked paid, pickup',
  'POST /requests/:id/office/no-scrap': 'Office marked no scrap at site, pickup',
  'POST /requests/:id/office/step-yard': 'Drop-off reached the yard, pickup',
  'PUT /board/yard': 'Changed the yard address',
  'POST /cash/give': 'Gave cash to staff',
  'POST /cash/settle': 'Settled cash with staff',
  'PUT /board/settings': 'Changed trucks per slot',
  'POST /rates/checked': 'Marked all rates as checked today',
  'PUT /subscribers/settings': 'Changed rate-alert settings',
  'POST /subscribers/send-rates': 'Sent the rates to subscribers',
  'POST /subscribers/announce': 'Sent an announcement to subscribers',
};
// Reads and housekeeping that change nothing worth logging.
const SKIP = new Set(['POST /login', 'POST /logout', 'POST /push', 'POST /push/status', 'DELETE /push', 'POST /push/test', 'POST /slots/check']);

// Body fields worth showing (never passwords).
// (staffId is shown as the staff member's name, see addStaffName.)
const FIELDS = ['status', 'step', 'method', 'name', 'username', 'active', 'price', 'unit', 'amount', 'returned', 'reference', 'perSlot', 'title', 'note', 'admin_notes',
  'provider', 'driver', 'vehicle', 'fare'];

function detailOf(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [];
  FIELDS.forEach((key) => {
    const value = body[key];
    if (value === undefined || value === null || value === '' || typeof value === 'object') return;
    const shown = key === 'step' ? ({ on_way: 'on the way', arrived: 'arrived' }[value] || value) : value;
    parts.push(`${key === 'admin_notes' ? 'notes' : key}: ${String(shown).slice(0, 80)}`);
  });
  if (Array.isArray(body.items)) parts.push(`${body.items.length} line${body.items.length === 1 ? '' : 's'}`);
  if (Array.isArray(body.slots)) parts.push(`${body.slots.length} slot${body.slots.length === 1 ? '' : 's'}`);
  return parts.join(', ').slice(0, 400);
}

function describe(method, path, body) {
  const ids = path.match(/\d+/g) || [];
  const shape = `${method} ${path.replace(/\/\d+(?=\/|$)/g, '/:id')}`;
  if (SKIP.has(shape)) return null;
  const id = ids[0] ? Number(ids[0]) : null;
  const special = ACTIONS[shape];
  const first = path.split('/')[1] || '';
  let action;
  if (special) action = special + (id && shape.includes(':id') ? ` #${id}` : '');
  else action = `${VERBS[method] || method} ${NOUNS[first] || first}${id ? ` #${id}` : ''}`;
  return { action, area: first, targetId: id, detail: detailOf(body) };
}

async function record(who, entry) {
  await pool.query(
    `INSERT INTO admin_activity (admin_id, admin_name, action, area, target_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [who.id || null, who.name || 'Unknown', entry.action.slice(0, 200), entry.area || null, entry.targetId, entry.detail || null]
  );
}

const quietly = (promise) => promise.catch((err) => console.error('activity log:', err.message));

// Mounted on /api/admin: logs each successful change once the reply is sent.
function middleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.session || !req.session.isAdmin) return;
    const entry = describe(req.method, req.path, req.body);
    if (entry) quietly(addStaffName(entry, req.body).then(() => record(whoIs(req), entry)));
  });
  next();
}

// "staff: Ravi" rather than a number (cash given, pickup assigned).
async function addStaffName(entry, body) {
  if (!body || body.staffId === undefined) return;
  const id = Number(body.staffId);
  let name = 'nobody';
  if (Number.isInteger(id) && id > 0) {
    const { rows } = await pool.query('SELECT name FROM staff_users WHERE id = $1', [id]);
    name = rows[0] ? rows[0].name : `#${id}`;
  }
  entry.detail = [`staff: ${name}`, entry.detail].filter(Boolean).join(', ');
}

const whoIs = (req) => ({ id: req.session.adminId, name: req.session.adminName || req.session.username });

// Newest first; filter by person and/or what it was about.
async function recent({ adminId, area, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (adminId) { params.push(adminId); where.push(`admin_id = $${params.length}`); }
  if (area) { params.push(area); where.push(`area = $${params.length}`); }
  params.push(Math.min(Number(limit) || 200, 500));
  return (await pool.query(
    `SELECT id, admin_id, admin_name, action, area, target_id, detail, created_at FROM admin_activity
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  )).rows;
}

// Old entries are cleared once a day.
function start() {
  const prune = () => quietly(pool.query(`DELETE FROM admin_activity WHERE created_at < NOW() - INTERVAL '${KEEP_DAYS} days'`));
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();
}

module.exports = {
  middleware, record, recent, describe, whoIs, quietly, start,
};
