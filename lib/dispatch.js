// Scheduling and doing a pickup, after the customer has accepted the quote:
//   1. the owner offers 2–3 pickup slots, with a deadline to choose by;
//   2. the customer picks one (My Account or their quote link);
//   3. every staff member is alerted, and whoever is free claims it (the
//      owner can reassign);
//   4. that staff member marks: on the way → arrived → weighed (photo of the
//      weighing machine + the weight) → paid.
// Every step changes the request's status, so the customer's timeline, the
// admin list and the staff app all show where things are (the database logs
// each change in request_events).
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const push = require('./push');
const live = require('./live');
const mailer = require('./mailer');
const documents = require('./documents');

const MAX_SLOTS = 4;
const MAX_DAYS_AHEAD = 45;
const DEFAULT_DEADLINE_HOURS = 24;
const PAYMENT_METHODS = { cash: 'Cash', bank: 'Bank transfer' };
// Where a pickup can still be handed to a different staff member.
const ASSIGNABLE = ['scheduled', 'on_way', 'arrived'];
// Where the owner can still (re)send slots.
const CAN_OFFER = ['accepted', 'ready', 'confirmed', 'slots_sent', 'scheduled'];

const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const toYmd = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value).slice(0, 10));

// "10:00:00" → "10 AM", "13:30" → "1:30 PM"
function clock(time) {
  const [h, m] = String(time).split(':').map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
// "Sat, 15 Nov · 10 AM – 1 PM"
function slotLabel(slot) {
  const date = new Date(`${toYmd(slot.slot_date)}T00:00:00`);
  const day = date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${clock(slot.time_from)} – ${clock(slot.time_to)}`;
}
const tidySlot = (slot) => ({
  id: slot.id, date: toYmd(slot.slot_date), from: String(slot.time_from).slice(0, 5), to: String(slot.time_to).slice(0, 5), label: slotLabel(slot),
});

// ---- slots ----

// Admin form → { slots, hours } or { error }.
function parseSlots(body) {
  const list = Array.isArray(body.slots) ? body.slots : [];
  if (list.length < 1 || list.length > MAX_SLOTS) return { error: `Add between 1 and ${MAX_SLOTS} slots (2 or 3 is best).` };
  const today = indiaToday();
  const last = new Date(Date.now() + MAX_DAYS_AHEAD * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const slots = [];
  for (const s of list) {
    const date = String(s.date || '');
    const from = String(s.from || '');
    const to = String(s.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > last) return { error: 'Each slot needs a date from today onwards.' };
    if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to) return { error: 'Each slot needs a start time before its end time.' };
    if (slots.some((x) => x.date === date && x.from === from && x.to === to)) return { error: 'Two slots are the same.' };
    slots.push({ date, from, to });
  }
  const hours = body.deadlineHours == null || body.deadlineHours === '' ? DEFAULT_DEADLINE_HOURS : Number(body.deadlineHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return { error: 'The time to choose must be between 1 hour and 7 days.' };
  return { slots, hours };
}

// Offer (or re-offer) slots. Returns { request, slots } or { error }.
async function offerSlots(requestId, slots, hours) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE pickup_requests
       SET status = 'slots_sent', slots_deadline = NOW() + ($2 || ' hours')::interval, slots_expiry_notified = FALSE,
           slot_id = NULL, slot_chosen_at = NULL, staff_id = NULL, staff_claimed_at = NULL
       WHERE id = $1 AND status = ANY($3)
       RETURNING id, customer_id, quote_token, name, email, company_name, slots_deadline`,
      [requestId, String(hours), CAN_OFFER]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return { error: 'Slots can be sent once the customer has accepted the quote, and before the pickup has started.' };
    }
    await client.query('DELETE FROM pickup_slots WHERE request_id = $1', [requestId]);
    const saved = [];
    for (const s of slots) {
      const { rows: [slot] } = await client.query(
        'INSERT INTO pickup_slots (request_id, slot_date, time_from, time_to) VALUES ($1,$2,$3,$4) RETURNING *',
        [requestId, s.date, s.from, s.to]
      );
      saved.push(tidySlot(slot));
    }
    await client.query('COMMIT');
    return { request: rows[0], slots: saved };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// The slots offered for each of these requests: Map(requestId → [slot]).
async function slotsFor(requestIds) {
  const map = new Map();
  if (!requestIds.length) return map;
  const { rows } = await pool.query(
    'SELECT * FROM pickup_slots WHERE request_id = ANY($1) ORDER BY slot_date, time_from', [requestIds]
  );
  rows.forEach((row) => {
    if (!map.has(row.request_id)) map.set(row.request_id, []);
    map.get(row.request_id).push(tidySlot(row));
  });
  return map;
}

// The customer picks a slot. `who` is { customerId } or { token }.
// Returns the request row, or { error }.
async function chooseSlot(requestId, who, slotId) {
  const { rows } = await pool.query(
    `UPDATE pickup_requests p
     SET status = 'scheduled', slot_id = s.id, slot_chosen_at = NOW()
     FROM pickup_slots s
     WHERE p.id = $1 AND s.id = $2 AND s.request_id = p.id
       AND p.status = 'slots_sent' AND p.slots_deadline > NOW()
       AND (($3::int IS NOT NULL AND p.customer_id = $3) OR ($4::text IS NOT NULL AND p.quote_token = $4))
     RETURNING p.id, p.customer_id, p.quote_token, p.company_name, p.area, p.approx_quantity, s.slot_date, s.time_from, s.time_to`,
    [requestId, slotId, who.customerId ?? null, who.token ?? null]
  );
  if (!rows[0]) return { error: 'This slot can no longer be chosen. Please refresh the page, or call us for new slots.' };
  return rows[0];
}

// For My Account and the quote link: Map(requestId → { slots, chosen,
// deadline, expired, staffName, weighedKg, payment }).
async function customerView(requestIds) {
  const map = new Map();
  if (!requestIds.length) return map;
  const [{ rows }, slots] = await Promise.all([
    pool.query(
      `SELECT p.id, p.slots_deadline, p.slots_deadline < NOW() AS expired, p.slot_id, p.weighed_kg, p.payment_method, u.name AS staff_name
       FROM pickup_requests p LEFT JOIN staff_users u ON u.id = p.staff_id WHERE p.id = ANY($1)`,
      [requestIds]
    ),
    slotsFor(requestIds),
  ]);
  rows.forEach((row) => {
    const offered = slots.get(row.id) || [];
    map.set(row.id, {
      slots: offered,
      chosen: offered.find((s) => s.id === row.slot_id) || null,
      deadline: row.slots_deadline,
      expired: Boolean(row.expired),
      // First name only: enough for "Ravi is on the way".
      staffName: row.staff_name ? row.staff_name.split(' ')[0] : null,
      weighedKg: row.weighed_kg == null ? null : Number(row.weighed_kg),
      payment: PAYMENT_METHODS[row.payment_method] || null,
    });
  });
  return map;
}

// ---- telling people ----

const requestChanged = (row) => live.requestChanged(row.customer_id, row.quote_token);

function announceSlots(request, slots) {
  requestChanged(request);
  push.quietly(push.notifyCustomer(request.customer_id, {
    title: 'Choose your pickup slot 🗓️',
    body: `Request #${request.id}: we've sent ${slots.length} pickup slot${slots.length === 1 ? '' : 's'}. Please choose one.`,
    url: '/account',
    tag: `pickup-${request.id}`,
  }));
  // Customers without an account get the link by email (and the owner can
  // share it on WhatsApp from the admin).
  if (request.email && mailer.enabled && request.quote_token) {
    const link = `${mailer.SITE_URL}/quote/${request.quote_token}`;
    const items = slots.map((s) => `<li style="margin:4px 0">${mailer.escapeHtml(s.label)}</li>`).join('');
    mailer.send({
      to: request.email,
      subject: `Choose your pickup slot for request #${request.id}`,
      text: [`Hello ${request.name},`, '', `Please choose a pickup slot for request #${request.id}:`,
        ...slots.map((s) => `- ${s.label}`), '', `Choose here: ${link}`].join('\n'),
      html: mailer.layout(`<h2 style="margin:0 0 12px;font-size:20px">Choose your pickup slot</h2>
        <p style="line-height:1.6">Hello ${mailer.escapeHtml(request.name)}, thank you for accepting our quote for request <strong>#${request.id}</strong>. These slots are free:</p>
        <ul style="padding-left:20px;line-height:1.6">${items}</ul>
        <p style="margin:24px 0"><a href="${link}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">Choose a Slot</a></p>
        <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0">This link is private to your request, so please don't share it.</p>`),
    }).catch((err) => console.error('Slot email failed:', err.message));
  }
}

function announceChosen(row) {
  requestChanged(row);
  const when = slotLabel(row);
  const what = [row.company_name, row.area, row.approx_quantity].filter(Boolean).join(' · ');
  push.quietly(push.notifyAdmins({
    title: `Slot chosen for pickup #${row.id} 🗓️`, body: `${when} · ${what}`, url: `/admin.html#pickup-${row.id}`, tag: `pickup-${row.id}`,
  }));
  push.quietly(push.notifyStaff({
    title: 'New pickup available 🚚', body: `${when} · ${what}`, url: '/staff.html', tag: `staff-pickup-${row.id}`,
  }));
}

const CUSTOMER_NOTICES = {
  on_way: (r) => ['Our team is on the way 🚚', `Pickup #${r.id}: ${r.staff_name || 'our team'} has left for your site.`],
  arrived: (r) => ['We have arrived 📍', `Pickup #${r.id}: our team is at your site.`],
  weighed: (r) => ['Your scrap is weighed ⚖️', `Pickup #${r.id}: ${Number(r.weighed_kg).toLocaleString('en-IN')} kg. The photo is in your account.`],
  completed: (r) => ['Pickup completed ✅', `Thank you! Pickup #${r.id} is complete and paid.`],
  no_scrap: (r) => ['No scrap found at the site', `Pickup #${r.id}: our team could not collect. Please call us.`],
};
function announceStep(row) {
  requestChanged(row);
  const notice = CUSTOMER_NOTICES[row.status];
  if (notice) {
    const [title, body] = notice(row);
    push.quietly(push.notifyCustomer(row.customer_id, {
      title, body, url: '/account', tag: `pickup-${row.id}`,
    }));
  }
  if (['weighed', 'completed', 'no_scrap'].includes(row.status)) {
    const [title] = notice(row);
    push.quietly(push.notifyAdmins({
      title: `#${row.id}: ${title}`,
      body: [row.company_name, row.staff_name, row.weighed_kg && `${Number(row.weighed_kg).toLocaleString('en-IN')} kg`].filter(Boolean).join(' · '),
      url: `/admin.html#pickup-${row.id}`,
      tag: `pickup-${row.id}`,
    }));
  }
}

// ---- staff accounts (made by the owner) ----

const publicStaff = 'id, name, phone, username, active, created_at, last_login_at';

async function listStaff() {
  const { rows } = await pool.query(
    `SELECT ${publicStaff},
            (SELECT COUNT(*)::int FROM pickup_requests p WHERE p.staff_id = s.id AND p.status IN ('scheduled', 'on_way', 'arrived', 'weighed')) AS open_pickups,
            (SELECT COUNT(*)::int FROM pickup_requests p WHERE p.staff_id = s.id AND p.status = 'completed') AS done_pickups
     FROM staff_users s ORDER BY active DESC, name`
  );
  return rows;
}

// Returns { staff } or { error }.
async function saveStaff(id, body, { cleanPhone }) {
  const name = String(body.name ?? '').trim().slice(0, 150);
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const phone = body.phone ? cleanPhone(body.phone) : null;
  if (!name) return { error: 'Please enter the staff member\'s name.' };
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) return { error: 'The username needs 3 or more letters or numbers, with no spaces.' };
  if (body.phone && !phone) return { error: 'That phone number doesn\'t look right.' };
  if (!id && password.length < 6) return { error: 'The password needs at least 6 characters.' };
  if (password && password.length < 6) return { error: 'The password needs at least 6 characters.' };
  const hash = password ? await bcrypt.hash(password, 10) : null;
  try {
    const { rows } = id
      ? await pool.query(
        `UPDATE staff_users SET name = $1, username = $2, phone = $3, password_hash = COALESCE($4, password_hash),
                active = COALESCE($5, active) WHERE id = $6 RETURNING ${publicStaff}`,
        [name, username, phone, hash, typeof body.active === 'boolean' ? body.active : null, id]
      )
      : await pool.query(
        `INSERT INTO staff_users (name, username, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING ${publicStaff}`,
        [name, username, phone, hash]
      );
    if (!rows[0]) return { error: 'That staff member no longer exists.' };
    return { staff: rows[0] };
  } catch (err) {
    if (err.code === '23505') return { error: 'That username is already taken.' };
    throw err;
  }
}

async function removeStaff(id) {
  await pool.query('DELETE FROM staff_users WHERE id = $1', [id]);
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function checkStaffLogin(username, password) {
  const { rows } = await pool.query('SELECT * FROM staff_users WHERE username = $1 AND active', [String(username).trim().toLowerCase()]);
  const user = rows[0];
  // Compare against something either way, so a wrong username takes as long.
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return null;
  await pool.query('UPDATE staff_users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  return { id: user.id, name: user.name, username: user.username };
}

async function findStaff(id) {
  const { rows } = await pool.query(`SELECT ${publicStaff} FROM staff_users WHERE id = $1 AND active`, [id]);
  return rows[0] || null;
}

// ---- the staff app ----

const STAFF_FIELDS = `p.id, p.status, p.company_name, p.name, p.phone, p.address, p.area, p.pincode, p.latitude, p.longitude,
  p.scrap_type, p.approx_quantity, p.item_quantities, p.notes, p.quote_items, p.staff_id, p.weighed_kg, p.payment_method,
  s.slot_date, s.time_from, s.time_to, u.name AS staff_name`;
const STAFF_FROM = `FROM pickup_requests p
  LEFT JOIN pickup_slots s ON s.id = p.slot_id
  LEFT JOIN staff_users u ON u.id = p.staff_id`;

function forStaff(row, staffId) {
  const mine = row.staff_id === staffId;
  return {
    id: row.id,
    status: row.status,
    mine,
    company: row.company_name,
    area: row.area,
    pincode: row.pincode,
    scrap: row.scrap_type,
    quantity: row.approx_quantity,
    items: row.item_quantities,
    slot: row.slot_date ? { date: toYmd(row.slot_date), label: slotLabel(row) } : null,
    // The contact and exact address are only for whoever is doing the pickup.
    ...(mine ? {
      contact: row.name,
      phone: row.phone,
      address: row.address,
      map: row.latitude != null
        ? `https://www.google.com/maps?q=${row.latitude},${row.longitude}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.address} ${row.pincode || ''}`)}`,
      notes: row.notes,
      quote: row.quote_items,
      weighedKg: row.weighed_kg == null ? null : Number(row.weighed_kg),
      payment: row.payment_method,
    } : {}),
  };
}

async function listForStaff(staffId) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_FIELDS} ${STAFF_FROM}
     WHERE (p.status = 'scheduled' AND p.staff_id IS NULL)
        OR (p.staff_id = $1 AND p.status IN ('scheduled', 'on_way', 'arrived', 'weighed'))
        OR (p.staff_id = $1 AND p.status IN ('completed', 'no_scrap') AND p.weighed_at > NOW() - interval '7 days')
        OR (p.staff_id = $1 AND p.status = 'no_scrap' AND p.staff_claimed_at > NOW() - interval '7 days')
     ORDER BY s.slot_date NULLS LAST, s.time_from NULLS LAST, p.id`,
    [staffId]
  );
  const all = rows.map((row) => forStaff(row, staffId));
  return {
    available: all.filter((p) => !p.mine),
    mine: all.filter((p) => p.mine && !['completed', 'no_scrap'].includes(p.status)),
    done: all.filter((p) => p.mine && ['completed', 'no_scrap'].includes(p.status)),
  };
}

// One changed request with everything the announcements need, or null.
async function changed(sql, params) {
  const { rows } = await pool.query(
    `WITH done AS (${sql})
     SELECT d.id, d.status, d.customer_id, d.quote_token, d.company_name, d.area, d.approx_quantity, d.weighed_kg, d.staff_id,
            u.name AS staff_name, s.slot_date, s.time_from, s.time_to
     FROM done d LEFT JOIN staff_users u ON u.id = d.staff_id LEFT JOIN pickup_slots s ON s.id = d.slot_id`,
    params
  );
  return rows[0] || null;
}

// First come, first served: only an unclaimed, scheduled pickup can be taken.
function claim(staffId, requestId) {
  return changed(
    `UPDATE pickup_requests SET staff_id = $1, staff_claimed_at = NOW()
     WHERE id = $2 AND status = 'scheduled' AND staff_id IS NULL RETURNING *`,
    [staffId, requestId]
  );
}

// Give a pickup back, before setting off.
function release(staffId, requestId) {
  return changed(
    `UPDATE pickup_requests SET staff_id = NULL, staff_claimed_at = NULL
     WHERE id = $2 AND staff_id = $1 AND status = 'scheduled' RETURNING *`,
    [staffId, requestId]
  );
}

const STEPS = { on_way: 'scheduled', arrived: 'on_way' };
function step(staffId, requestId, to) {
  if (!STEPS[to]) return null;
  return changed(
    `UPDATE pickup_requests SET status = $3::varchar
     WHERE id = $2 AND staff_id = $1 AND status = $4 RETURNING *`,
    [staffId, requestId, to, STEPS[to]]
  );
}

// Weighed: the weight and a photo of the weighing machine, together.
async function weigh(staffId, requestId, kg, doc) {
  const row = await changed(
    `UPDATE pickup_requests SET status = 'weighed', weighed_kg = $3, weighed_at = NOW()
     WHERE id = $2 AND staff_id = $1 AND status IN ('arrived', 'weighed') RETURNING *`,
    [staffId, requestId, kg]
  );
  if (!row) return null;
  // A corrected weight replaces the earlier photo.
  const { rows: old } = await pool.query(
    "DELETE FROM request_documents WHERE request_type = 'pickup' AND request_id = $1 AND kind = 'weigh_photo' RETURNING file_name",
    [requestId]
  );
  await documents.removeFiles(old.map((d) => d.file_name));
  await documents.add('pickup', requestId, 'weigh_photo', doc);
  return row;
}

function paid(staffId, requestId, method) {
  if (!PAYMENT_METHODS[method]) return null;
  return changed(
    `UPDATE pickup_requests SET status = 'completed', payment_method = $3
     WHERE id = $2 AND staff_id = $1 AND status = 'weighed' RETURNING *`,
    [staffId, requestId, method]
  );
}

function noScrap(staffId, requestId) {
  return changed(
    `UPDATE pickup_requests SET status = 'no_scrap'
     WHERE id = $2 AND staff_id = $1 AND status = 'arrived' RETURNING *`,
    [staffId, requestId]
  );
}

// The owner hands a pickup to someone (or back to "anyone").
function assign(requestId, staffId) {
  return changed(
    `UPDATE pickup_requests SET staff_id = $2, staff_claimed_at = CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() END
     WHERE id = $1 AND status = ANY($3)
       AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM staff_users WHERE id = $2 AND active))
     RETURNING *`,
    [requestId, staffId, ASSIGNABLE]
  );
}

// ---- slots nobody chose in time: tell the owner once ----

async function notifyExpired() {
  const { rows } = await pool.query(
    `UPDATE pickup_requests SET slots_expiry_notified = TRUE
     WHERE status = 'slots_sent' AND slots_deadline < NOW() AND NOT slots_expiry_notified
     RETURNING id, company_name, phone`
  );
  rows.forEach((row) => {
    push.quietly(push.notifyAdmins({
      title: `No slot chosen for pickup #${row.id} ⏰`,
      body: `${row.company_name} didn't choose in time. Call ${row.phone} or send new slots.`,
      url: `/admin.html#pickup-${row.id}`,
      tag: `pickup-${row.id}`,
    }));
  });
  if (rows.length) live.publish('requests');
  return rows.length;
}

function start() {
  const run = () => notifyExpired().catch((err) => console.error('Slot deadline check failed:', err.message));
  setTimeout(run, 45 * 1000);
  setInterval(run, 10 * 60 * 1000);
}

module.exports = {
  PAYMENT_METHODS, DEFAULT_DEADLINE_HOURS, MAX_SLOTS, CAN_OFFER, ASSIGNABLE,
  parseSlots, offerSlots, slotsFor, chooseSlot, slotLabel, customerView,
  announceSlots, announceChosen, announceStep, requestChanged,
  listStaff, saveStaff, removeStaff, checkStaffLogin, findStaff,
  listForStaff, claim, release, step, weigh, paid, noScrap, assign, notifyExpired, start,
};
