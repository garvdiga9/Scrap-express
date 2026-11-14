// The dispatch board: pickups booked (and slots offered) by date and time,
// and how many pickups can run at the same time ("trucks per slot", set in
// the admin), so the same morning isn't promised to more customers than
// there are trucks.
const pool = require('../db/pool');
const settings = require('./settings');

const KEY = 'dispatch';
const DEFAULT_PER_SLOT = 2;
// Booked = a customer chose this slot and it isn't finished or cancelled yet.
const BOOKED = ['scheduled', 'on_way', 'arrived', 'weighed'];

async function getSettings() {
  const saved = await settings.get(KEY, {}).catch(() => ({}));
  return { perSlot: Number.isInteger(saved.perSlot) ? saved.perSlot : DEFAULT_PER_SLOT };
}

async function saveSettings(body) {
  const perSlot = Number(body.perSlot);
  if (!Number.isInteger(perSlot) || perSlot < 1 || perSlot > 50) return { error: 'Trucks per slot must be a whole number from 1 to 50.' };
  await settings.set(KEY, { perSlot });
  return { settings: { perSlot } };
}

// Where drop-offs come: { address, hours, map, pocName, pocPhone } (all
// optional). The contact person (POC) is who the customer calls at the yard.
const YARD_KEY = 'yard';
async function yard() {
  const saved = await settings.get(YARD_KEY, {}).catch(() => ({}));
  return {
    address: saved.address || '', hours: saved.hours || '', map: saved.map || '', pocName: saved.pocName || '', pocPhone: saved.pocPhone || '',
  };
}
async function saveYard(body) {
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const digits = String(body.pocPhone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const value = {
    address: text(body.address, 300), hours: text(body.hours, 120), map: text(body.map, 500), pocName: text(body.pocName, 100), pocPhone: digits,
  };
  if (digits && !/^[6-9]\d{9}$/.test(digits)) return { error: "The contact person's phone number doesn't look right." };
  if (value.map && !/^https:\/\/[^\s]+$/.test(value.map)) return { error: 'The map link must start with https://' };
  await settings.set(YARD_KEY, value);
  return { yard: value };
}

const toYmd = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value).slice(0, 10));
const hhmm = (t) => String(t).slice(0, 5);

// Booked pickups whose time overlaps this window on this date.
async function bookedAt(date, from, to, { exceptRequestId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
     WHERE p.status = ANY($1) AND s.slot_date = $2 AND s.time_from < $4 AND s.time_to > $3
       AND ($5::int IS NULL OR p.id <> $5) AND NOT p.office_handled`,
    [BOOKED, date, from, to, exceptRequestId]
  );
  return rows[0].n;
}

// Is there room in this slot? { ok, booked, perSlot }
async function hasRoom(slot, exceptRequestId) {
  const [{ perSlot }, booked] = await Promise.all([
    getSettings(), bookedAt(toYmd(slot.slot_date || slot.date), hhmm(slot.time_from || slot.from), hhmm(slot.time_to || slot.to), { exceptRequestId }),
  ]);
  return { ok: booked < perSlot, booked, perSlot };
}

// For the slot form: how busy each proposed slot already is.
async function check(slots) {
  const { perSlot } = await getSettings();
  return Promise.all(slots.map(async (s) => {
    const booked = await bookedAt(s.date, s.from, s.to);
    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT p.id)::int AS n FROM pickup_requests p JOIN pickup_slots s ON s.request_id = p.id
       WHERE p.status = 'slots_sent' AND p.slots_deadline > NOW() AND s.slot_date = $1 AND s.time_from < $3 AND s.time_to > $2`,
      [s.date, s.from, s.to]
    );
    return {
      ...s, booked, offered: rows[0].n, perSlot, full: booked >= perSlot,
    };
  }));
}

// The board: each day from today for `days` days, its booked pickups and
// the slots still waiting for a customer's answer.
async function board(days = 7) {
  const { perSlot } = await getSettings();
  const { rows: booked } = await pool.query(
    `SELECT p.id, p.status, p.company_name, p.area, p.approx_quantity, p.phone, u.name AS staff_name,
            p.office_handled, p.outside_provider, p.delivery_mode, s.slot_date, s.time_from, s.time_to
     FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id LEFT JOIN staff_users u ON u.id = p.staff_id
     WHERE p.status = ANY($1) AND s.slot_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1
       AND s.slot_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date + $2::int
     ORDER BY s.slot_date, s.time_from, p.id`,
    [[...BOOKED, 'completed', 'no_scrap'], days]
  );
  const { rows: offered } = await pool.query(
    `SELECT p.id, p.company_name, p.area, p.slots_deadline, s.slot_date, s.time_from, s.time_to
     FROM pickup_requests p JOIN pickup_slots s ON s.request_id = p.id
     WHERE p.status = 'slots_sent' AND p.slots_deadline > NOW()
       AND s.slot_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND s.slot_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date + $1::int
     ORDER BY s.slot_date, s.time_from`,
    [days]
  );
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const daysOut = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    const label = new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    const windows = new Map();
    const add = (row, kind) => {
      const key = `${hhmm(row.time_from)}-${hhmm(row.time_to)}`;
      if (!windows.has(key)) windows.set(key, { from: hhmm(row.time_from), to: hhmm(row.time_to), booked: [], offered: [] });
      windows.get(key)[kind].push(row);
    };
    booked.filter((r) => toYmd(r.slot_date) === ymd).forEach((r) => add(r, 'booked'));
    offered.filter((r) => toYmd(r.slot_date) === ymd).forEach((r) => add(r, 'offered'));
    const list = [...windows.values()].sort((a, b) => a.from.localeCompare(b.from)).map((w) => ({
      ...w,
      // Outside trucks are extra: they don't fill our own trucks.
      active: w.booked.filter((r) => BOOKED.includes(r.status) && !r.office_handled).length,
      full: w.booked.filter((r) => BOOKED.includes(r.status) && !r.office_handled).length >= perSlot,
    }));
    daysOut.push({
      date: ymd, label: i === 0 ? `Today, ${label}` : i === 1 ? `Tomorrow, ${label}` : label, windows: list,
    });
  }
  // Booked pickups with no staff member yet: the thing to sort out first.
  const unassigned = booked.filter((r) => r.status === 'scheduled' && !r.staff_name && !r.office_handled).length;
  return {
    perSlot, days: daysOut, unassigned,
  };
}

module.exports = {
  getSettings, saveSettings, hasRoom, check, board, BOOKED, yard, saveYard,
};
