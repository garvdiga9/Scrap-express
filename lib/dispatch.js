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
const notify = require('./notify');
const board = require('./board');

const whatsappOn = () => notify.channels().whatsapp;
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
  const { rows: picked } = await pool.query('SELECT * FROM pickup_slots WHERE id = $1 AND request_id = $2', [slotId, requestId]);
  if (picked[0]) {
    const room = await board.hasRoom(picked[0], requestId);
    if (!room.ok) return { error: 'Sorry, this slot has just filled up. Please choose another one, or call us.' };
  }
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
      `SELECT p.id, p.slots_deadline, p.slots_deadline < NOW() AS expired, p.slot_id, p.weighed_kg, p.payment_method, u.name AS staff_name, ${OUTSIDE_NAME('p')} AS outside_name,
              p.weighed_items, p.amount_due, p.amount_paid, p.paid_at, p.payment_note, p.payment_method AS method, p.bank_paid_at, p.bank_reference
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
      staffName: row.outside_name || (row.staff_name ? row.staff_name.split(' ')[0] : null),
      outsideTruck: Boolean(row.outside_name),
      weighedKg: row.weighed_kg == null ? null : Number(row.weighed_kg),
      items: row.weighed_items || null,
      amountDue: row.amount_due == null ? null : Number(row.amount_due),
      amountPaid: row.amount_paid == null ? null : Number(row.amount_paid),
      paidAt: row.paid_at,
      paymentNote: row.payment_note,
      // Bank transfers: waiting until the office marks it sent.
      bankPending: row.method === 'bank' && !row.bank_paid_at,
      bankReference: row.bank_reference,
      payment: PAYMENT_METHODS[row.payment_method] || null,
    });
  });
  return map;
}

// ---- the customer changes their mind (before our team sets off) ----

// `who` is { customerId } or { token }, as for chooseSlot.
const WHO_SQL = '(($2::int IS NOT NULL AND p.customer_id = $2) OR ($3::text IS NOT NULL AND p.quote_token = $3))';
const whoParams = (who) => [who.customerId ?? null, who.token ?? null];

// Move to another of the slots offered, if it's still ahead and has room.
async function changeSlot(requestId, who, slotId) {
  const { rows: picked } = await pool.query(
    `SELECT s.* FROM pickup_slots s JOIN pickup_requests p ON p.id = s.request_id
     WHERE s.id = $4 AND p.id = $1 AND p.status = 'scheduled' AND p.slot_id <> s.id AND ${WHO_SQL}
       AND s.slot_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
    [requestId, ...whoParams(who), slotId]
  );
  if (!picked[0]) return { error: 'This time can no longer be chosen. Please refresh the page, or call us.' };
  const room = await board.hasRoom(picked[0], requestId);
  if (!room.ok) return { error: 'Sorry, that time is full. Please choose another one, or ask for new times.' };
  const row = await changed(
    `UPDATE pickup_requests p SET slot_id = $4, slot_chosen_at = NOW()
     WHERE p.id = $1 AND p.status = 'scheduled' AND ${WHO_SQL} RETURNING p.*`,
    [requestId, ...whoParams(who), slotId]
  );
  return row || { error: 'This pickup can no longer be changed. Please call us.' };
}

// None of the times work: back to the owner for new slots. Whoever had the
// pickup is let go.
async function askNewSlots(requestId, who) {
  const { rows: before } = await pool.query(`SELECT staff_id FROM pickup_requests p WHERE p.id = $1 AND ${WHO_SQL}`, [requestId, ...whoParams(who)]);
  const row = await changed(
    `UPDATE pickup_requests p SET status = 'accepted', slot_id = NULL, slot_chosen_at = NULL, staff_id = NULL, staff_claimed_at = NULL,
            slots_deadline = NULL, office_handled = FALSE
     WHERE p.id = $1 AND p.status IN ('slots_sent', 'scheduled') AND ${WHO_SQL} RETURNING p.*`,
    [requestId, ...whoParams(who)]
  );
  if (!row) return { error: 'This pickup can no longer be changed. Please call us.' };
  return { ...row, previous_staff_id: before[0] && before[0].staff_id };
}

async function cancelByCustomer(requestId, who, reason) {
  const text = String(reason ?? '').trim().slice(0, 300);
  if (!text) return { error: 'Please tell us why you are cancelling.' };
  const { rows: before } = await pool.query(`SELECT staff_id FROM pickup_requests p WHERE p.id = $1 AND ${WHO_SQL}`, [requestId, ...whoParams(who)]);
  const row = await changed(
    `UPDATE pickup_requests p SET status = 'cancelled', cancel_reason = $4, cancelled_by = 'customer'
     WHERE p.id = $1 AND p.status IN ('accepted', 'slots_sent', 'scheduled', 'ready', 'confirmed') AND ${WHO_SQL} RETURNING p.*`,
    [requestId, ...whoParams(who), text]
  );
  if (!row) return { error: 'This pickup can no longer be cancelled online, as our team may already be on the way. Please call us on +91 98188 26333.' };
  return { ...row, previous_staff_id: before[0] && before[0].staff_id };
}

// Tell the owner, and the staff member who had it.
function announceChange(kind, row, reason) {
  requestChanged(row);
  const what = [row.company_name, row.area].filter(Boolean).join(' · ');
  const texts = {
    moved: [`Pickup #${row.id} moved 🗓️`, `New time: ${row.slot_date ? slotLabel(row) : ''} · ${what}`],
    new_slots: [`Pickup #${row.id}: needs new times`, `The customer can't do any of the times. Send new slots. ${what}`],
    cancelled: [`Pickup #${row.id} cancelled by the customer ✖`, `${reason || ''} · ${what}`],
  };
  const [title, body] = texts[kind];
  push.quietly(push.notifyAdmins({
    title, body, url: `/admin.html#pickup-${row.id}`, tag: `pickup-${row.id}`,
  }));
  const staffId = row.previous_staff_id || row.staff_id;
  if (staffId) {
    push.quietly(push.notifyStaff({
      title: kind === 'moved' ? `Pickup #${row.id}: new time` : `Pickup #${row.id} is off your list`,
      body: kind === 'moved' ? body : (kind === 'cancelled' ? 'The customer cancelled it.' : 'The customer asked for new times.'),
      url: '/staff.html',
      tag: `staff-pickup-${row.id}`,
    }, { onlyId: staffId }));
  }
  if (kind === 'cancelled') notify.quietly('cancelled', row.id);
}

// ---- telling people ----

const requestChanged = (row) => live.requestChanged(row.customer_id, row.quote_token);

function announceSlots(request, slots) {
  requestChanged(request);
  const deadlineText = new Date(request.slots_deadline).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
  // Email is sent below with the list of slots; WhatsApp gets the short version.
  if (whatsappOn()) notify.quietly('slots_sent', request.id, { deadlineText });
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
  notify.quietly('scheduled', row.id, { slotText: when });
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
  weighed: (r) => ['Your scrap is weighed ⚖️', `Pickup #${r.id}: ${Number(r.weighed_kg).toLocaleString('en-IN')} kg${r.amount_due != null ? `, ₹${Number(r.amount_due).toLocaleString('en-IN')}` : ''}. The receipt and photo are in your account.`],
  completed: (r) => ['Pickup completed ✅', `Thank you! Pickup #${r.id} is complete and paid.`],
  no_scrap: (r) => ['No scrap found at the site', `Pickup #${r.id}: our team could not collect. Please call us.`],
};
function announceStep(row) {
  requestChanged(row);
  if (['on_way', 'weighed', 'completed', 'no_scrap'].includes(row.status)) notify.quietly(row.status, row.id);
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

// ---- weights and the amount ----

const round2 = (n) => Math.round(n * 100) / 100;

// Each quoted line and what was weighed for it. quantities[i] is kg for
// "per kg" and "per tonne" lines, pieces for "per piece", and ignored for a
// "lump sum" (its rate is the amount). Returns { items, kg, amount } or { error }.
function priceWeighing(quoteItems, quantities) {
  const lines = Array.isArray(quoteItems) ? quoteItems : [];
  if (!lines.length) return { error: 'This pickup has no quote to work the amount out from.' };
  if (!Array.isArray(quantities) || quantities.length !== lines.length) return { error: 'Please enter a weight for each material.' };
  const items = [];
  for (const [i, line] of lines.entries()) {
    const rate = Number(line.rate);
    const raw = quantities[i];
    const qty = line.unit === 'lump sum' ? 1 : Number(raw === '' || raw == null ? 0 : raw);
    if (!Number.isFinite(qty) || qty < 0 || qty > 10000000) return { error: `Please check the weight for ${line.material}.` };
    const kg = ['per kg', 'per tonne'].includes(line.unit) ? qty : null;
    let amount = 0;
    if (line.unit === 'per kg') amount = qty * rate;
    else if (line.unit === 'per tonne') amount = (qty / 1000) * rate;
    else if (line.unit === 'per piece') amount = qty * rate;
    else amount = rate;
    items.push({
      material: line.material, unit: line.unit, rate, qty: line.unit === 'lump sum' ? null : qty, kg, amount: round2(amount),
    });
  }
  const kg = round2(items.reduce((sum, item) => sum + (item.kg || 0), 0));
  const counted = items.filter((item) => item.unit !== 'lump sum' && item.qty > 0).length;
  if (!counted && !items.some((item) => item.unit === 'lump sum')) return { error: 'Please enter the weight for at least one material.' };
  return { items, kg, amount: round2(items.reduce((sum, item) => sum + item.amount, 0)) };
}

// ---- is the weighing photo new, and taken at the site? ----

const PHOTO_MAX_AGE_MIN = 60;
const SITE_RADIUS_M = 1000;

// Metres between two points.
function distanceM(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(a)));
}

// meta: { takenAt (ms), latitude, longitude } from the staff phone.
// site: { latitude, longitude } of the customer's pin, when there is one.
// Returns what to store, with a list of warnings for the owner.
function photoChecks(meta, site, now = Date.now()) {
  const warnings = [];
  const takenAt = Number(meta.takenAt);
  const validTime = Number.isFinite(takenAt) && takenAt > 0 && takenAt <= now + 5 * 60000;
  if (!validTime) warnings.push('The phone did not say when the photo was taken.');
  else if (now - takenAt > PHOTO_MAX_AGE_MIN * 60000) {
    const hours = (now - takenAt) / 3600000;
    warnings.push(`The photo was taken ${hours >= 24 ? `${Math.round(hours / 24)} day(s)` : `${Math.max(1, Math.round(hours))} hour(s)`} before it was uploaded.`);
  }
  const lat = Number(meta.latitude);
  const lon = Number(meta.longitude);
  const hasPlace = meta.latitude != null && meta.latitude !== '' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  let distance = null;
  if (!hasPlace) warnings.push('The phone did not share its location when the photo was uploaded.');
  else if (site && site.latitude != null && site.longitude != null) {
    distance = distanceM(lat, lon, Number(site.latitude), Number(site.longitude));
    if (distance > SITE_RADIUS_M) warnings.push(`Uploaded ${(distance / 1000).toFixed(1)} km from the customer's map pin.`);
  }
  return {
    takenAt: validTime ? new Date(takenAt) : null,
    latitude: hasPlace ? Math.round(lat * 1e6) / 1e6 : null,
    longitude: hasPlace ? Math.round(lon * 1e6) / 1e6 : null,
    distance,
    warnings,
  };
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

// "Raju (Porter truck, DL1LA1234)" or "Our Porter truck": who the customer
// is told is coming when the office sent an outside truck.
const OUTSIDE_NAME = (a) => `CASE WHEN ${a}.office_handled THEN
  CASE WHEN COALESCE(${a}.outside_driver, '') <> ''
    THEN ${a}.outside_driver || ' (' || COALESCE(${a}.outside_provider, 'partner') || ' truck' || COALESCE(', ' || NULLIF(${a}.outside_vehicle, ''), '') || ')'
    ELSE 'Our ' || COALESCE(${a}.outside_provider, 'partner') || ' truck' || COALESCE(' (' || NULLIF(${a}.outside_vehicle, '') || ')', '') END
  END`;

// ---- the staff app ----

const STAFF_FIELDS = `p.id, p.status, p.company_name, p.name, p.phone, p.address, p.area, p.pincode, p.latitude, p.longitude,
  p.scrap_type, p.approx_quantity, p.item_quantities, p.notes, p.quote_items, p.staff_id, p.weighed_kg, p.payment_method,
  p.weighed_items, p.amount_due, p.amount_paid,
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
      weighedItems: row.weighed_items,
      amountDue: row.amount_due == null ? null : Number(row.amount_due),
      amountPaid: row.amount_paid == null ? null : Number(row.amount_paid),
      payment: row.payment_method,
    } : {}),
  };
}

async function listForStaff(staffId) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_FIELDS} ${STAFF_FROM}
     WHERE (p.status = 'scheduled' AND p.staff_id IS NULL AND NOT p.office_handled)
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
            d.amount_due, d.amount_paid, d.payment_method, d.office_handled,
            COALESCE(u.name, ${OUTSIDE_NAME('d')}) AS staff_name, s.slot_date, s.time_from, s.time_to
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

// Who may do a step: the staff member the pickup belongs to or, when staffId
// is null, the office, for a pickup it runs with an outside truck.
const ACTOR = (n) => `(CASE WHEN $${n}::int IS NULL THEN office_handled ELSE staff_id = $${n}::int END)`;

const STEPS = { on_way: 'scheduled', arrived: 'on_way' };
function step(staffId, requestId, to) {
  if (!STEPS[to]) return null;
  return changed(
    `UPDATE pickup_requests SET status = $3::varchar
     WHERE id = $2 AND ${ACTOR(1)} AND status = $4 RETURNING *`,
    [staffId, requestId, to, STEPS[to]]
  );
}

// Weighed: the weight and a photo of the weighing machine, together.
// Weighed: a weight for each quoted material, and a photo of the weighing
// machine. Returns the changed request, null when it has moved on, or { error }.
async function weigh(staffId, requestId, quantities, doc, photoMeta = {}) {
  const { rows: found } = await pool.query(
    `SELECT quote_items, latitude, longitude FROM pickup_requests WHERE id = $1 AND ${ACTOR(2)} AND status IN ('arrived', 'weighed')`,
    [requestId, staffId]
  );
  if (!found[0]) return null;
  const priced = priceWeighing(found[0].quote_items, quantities);
  if (priced.error) return priced;
  // The office enters a weighing from its desk (the photo, if any, came from
  // the driver), so the time and place checks are only for staff.
  const photo = staffId == null
    ? {
      takenAt: null, latitude: null, longitude: null, distance: null, warnings: [],
    }
    : photoChecks(photoMeta, found[0]);
  const row = await changed(
    `UPDATE pickup_requests SET status = 'weighed', weighed_kg = $3, weighed_items = $4, amount_due = $5, weighed_at = NOW(),
            weigh_photo_taken_at = $6, weigh_latitude = $7, weigh_longitude = $8, weigh_distance_m = $9, weigh_warnings = $10
     WHERE id = $2 AND ${ACTOR(1)} AND status IN ('arrived', 'weighed') RETURNING *`,
    [staffId, requestId, priced.kg, JSON.stringify(priced.items), priced.amount,
      photo.takenAt, photo.latitude, photo.longitude, photo.distance, photo.warnings.length ? JSON.stringify(photo.warnings) : null]
  );
  if (!row) return null;
  // Something odd about the photo: tell the owner straight away.
  if (photo.warnings.length) {
    push.quietly(push.notifyAdmins({
      title: `Check the weighing photo for #${requestId} ⚠️`,
      body: photo.warnings.join(' '),
      url: `/admin.html#pickup-${requestId}`,
      tag: `pickup-${requestId}-photo`,
    }));
  }
  if (!doc) return row; // the office may weigh without a photo
  // A corrected weight replaces the earlier photo.
  const { rows: old } = await pool.query(
    "DELETE FROM request_documents WHERE request_type = 'pickup' AND request_id = $1 AND kind = 'weigh_photo' RETURNING file_name",
    [requestId]
  );
  await documents.removeFiles(old.map((d) => d.file_name));
  await documents.add('pickup', requestId, 'weigh_photo', doc);
  return row;
}

// Paid: how, and how much was actually paid. An amount different from the
// one worked out needs a reason. Returns the request, null, or { error }.
async function paid(staffId, requestId, method, amountPaid, note) {
  if (!PAYMENT_METHODS[method]) return { error: 'Please choose cash or bank transfer.' };
  const { rows: found } = await pool.query(
    `SELECT amount_due FROM pickup_requests WHERE id = $1 AND ${ACTOR(2)} AND status = 'weighed'`, [requestId, staffId]
  );
  if (!found[0]) return null;
  const due = found[0].amount_due == null ? null : Number(found[0].amount_due);
  const amount = amountPaid === '' || amountPaid == null ? due : Number(amountPaid);
  if (amount == null || !Number.isFinite(amount) || amount < 0 || amount > 100000000) return { error: 'Please enter the amount paid.' };
  const reason = String(note ?? '').trim().slice(0, 300);
  if (due != null && Math.abs(amount - due) >= 1 && !reason) {
    return { error: 'The amount is different from the one worked out. Please write the reason.' };
  }
  return changed(
    `UPDATE pickup_requests SET status = 'completed', payment_method = $3, amount_paid = $4, payment_note = $5, paid_at = NOW()
     WHERE id = $2 AND ${ACTOR(1)} AND status = 'weighed' RETURNING *`,
    [staffId, requestId, method, round2(amount), reason || null]
  );
}

function noScrap(staffId, requestId) {
  return changed(
    `UPDATE pickup_requests SET status = 'no_scrap'
     WHERE id = $2 AND ${ACTOR(1)} AND status = 'arrived' RETURNING *`,
    [staffId, requestId]
  );
}

// The owner hands a pickup to someone (or back to "anyone").
function assign(requestId, staffId) {
  return changed(
    `UPDATE pickup_requests SET staff_id = $2, staff_claimed_at = CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() END, office_handled = FALSE
     WHERE id = $1 AND status = ANY($3)
       AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM staff_users WHERE id = $2 AND active))
     RETURNING *`,
    [requestId, staffId, ASSIGNABLE]
  );
}

// ---- outside trucks: the office runs the pickup itself ----

const clip = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// { provider, driver, phone, vehicle, fare } → the changed request (with
// previous_staff_id, to tell them it's off their list), null, or { error }.
async function useOutsideTruck(requestId, body) {
  const provider = clip(body.provider, 40);
  const driver = clip(body.driver, 100);
  const vehicle = clip(body.vehicle, 20).toUpperCase();
  const digits = String(body.phone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const fare = body.fare === '' || body.fare == null ? null : Number(body.fare);
  if (!provider) return { error: 'Please choose who the truck is from (Porter, Delhivery or other).' };
  if (digits && !/^[6-9]\d{9}$/.test(digits)) return { error: "The driver's phone number doesn't look right." };
  if (fare != null && (!Number.isFinite(fare) || fare < 0 || fare > 1000000)) return { error: 'Please enter the truck fare in rupees, or leave it empty.' };
  const { rows: before } = await pool.query('SELECT staff_id FROM pickup_requests WHERE id = $1', [requestId]);
  const row = await changed(
    `UPDATE pickup_requests SET staff_id = NULL, staff_claimed_at = COALESCE(staff_claimed_at, NOW()), office_handled = TRUE,
            outside_provider = $2, outside_driver = $3, outside_phone = $4, outside_vehicle = $5, outside_fare = $6
     WHERE id = $1 AND status = ANY($7) RETURNING *`,
    [requestId, provider, driver || null, digits || null, vehicle || null, fare == null ? null : round2(fare), ASSIGNABLE]
  );
  if (!row) return null;
  return { ...row, previous_staff_id: before[0] && before[0].staff_id };
}

// The office books one of the offered times for the customer (say they
// called): no deadline or trucks-per-slot limit, since the office decides.
async function bookForCustomer(requestId, slotId) {
  const { rows: before } = await pool.query('SELECT status, staff_id FROM pickup_requests WHERE id = $1', [requestId]);
  const row = await changed(
    `UPDATE pickup_requests p SET status = 'scheduled', slot_id = $2, slot_chosen_at = NOW()
     WHERE p.id = $1 AND p.status IN ('slots_sent', 'scheduled')
       AND EXISTS (SELECT 1 FROM pickup_slots s WHERE s.id = $2 AND s.request_id = p.id) RETURNING p.*`,
    [requestId, slotId]
  );
  if (!row) return null;
  return { ...row, was_scheduled: before[0] && before[0].status === 'scheduled' };
}

function announceBooked(row) {
  requestChanged(row);
  const when = slotLabel(row);
  notify.quietly('scheduled', row.id, { slotText: when });
  push.quietly(push.notifyCustomer(row.customer_id, {
    title: row.was_scheduled ? 'Your pickup time has changed 🗓️' : 'Your pickup is booked 🗓️',
    body: `Pickup #${row.id}: ${when}`,
    url: '/account',
    tag: `pickup-${row.id}`,
  }));
  if (row.office_handled) return;
  const what = [row.company_name, row.area, row.approx_quantity].filter(Boolean).join(' · ');
  if (row.staff_id) {
    push.quietly(push.notifyStaff({
      title: `Pickup #${row.id}: new time`, body: `${when} · ${what}`, url: '/staff.html', tag: `staff-pickup-${row.id}`,
    }, { onlyId: row.staff_id }));
  } else {
    push.quietly(push.notifyStaff({
      title: 'New pickup available 🚚', body: `${when} · ${what}`, url: '/staff.html', tag: `staff-pickup-${row.id}`,
    }));
  }
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
  useOutsideTruck, bookForCustomer, announceBooked,
  PAYMENT_METHODS, DEFAULT_DEADLINE_HOURS, MAX_SLOTS, CAN_OFFER, ASSIGNABLE,
  parseSlots, offerSlots, slotsFor, chooseSlot, slotLabel, customerView,
  announceSlots, announceChosen, announceStep, requestChanged,
  listStaff, saveStaff, removeStaff, checkStaffLogin, findStaff,
  listForStaff, claim, release, step, weigh, paid, noScrap, assign, notifyExpired, start, priceWeighing, photoChecks, distanceM,
  changeSlot, askNewSlots, cancelByCustomer, announceChange,
};
