// Repeat pickups: a customer picks one of their earlier pickups and asks for
// it again, once or every week, fortnight or month. A couple of days before
// each date a new request is created from the earlier one (same site, scrap
// and contact), so it goes through the normal quote → confirm steps, and the
// team is alerted.
const pool = require('../db/pool');
const { RULES_VERSION } = require('../data/business');
const push = require('./push');
const live = require('./live');

const FREQUENCIES = {
  once: { label: 'Once', days: null, months: null },
  weekly: { label: 'Every week', days: 7 },
  fortnightly: { label: 'Every 2 weeks', days: 14 },
  monthly: { label: 'Every month', months: 1 },
};
// How long before the date the request is created.
const LEAD_DAYS = 2;
const MAX_AHEAD_DAYS = 90;
const CHECK_EVERY_MS = 60 * 60 * 1000;

// 'YYYY-MM-DD' in India.
const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ymd, months) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); // 31 Jan → 28/29 Feb
  return d.toISOString().slice(0, 10);
};
function nextAfter(ymd, frequency) {
  const f = FREQUENCIES[frequency];
  if (f.days) return addDays(ymd, f.days);
  if (f.months) return addMonths(ymd, f.months);
  return null;
}

const toYmd = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value).slice(0, 10));

// The dates a customer can choose for the first pickup.
const dateRange = () => ({ min: addDays(indiaToday(), LEAD_DAYS), max: addDays(indiaToday(), MAX_AHEAD_DAYS) });

// Returns { schedule } or { error }.
async function createSchedule(customerId, { sourceRequestId, frequency, startDate, acceptTerms }) {
  if (!FREQUENCIES[frequency]) return { error: 'Please choose how often.' };
  const range = dateRange();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate)) || startDate < range.min || startDate > range.max) {
    return { error: `Please choose a date between ${range.min} and ${range.max}.` };
  }
  if (!acceptTerms) return { error: 'Please accept the Pickup Rules.' };
  const { rows: source } = await pool.query(
    "SELECT id FROM pickup_requests WHERE id = $1 AND customer_id = $2 AND status NOT IN ('cancelled')",
    [sourceRequestId, customerId]
  );
  if (!source[0]) return { error: 'That pickup was not found on your account.' };
  const { rows } = await pool.query(
    `INSERT INTO pickup_schedules (customer_id, source_request_id, frequency, next_date, terms_version)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [customerId, sourceRequestId, frequency, startDate, RULES_VERSION]
  );
  return { schedule: rows[0] };
}

async function listForCustomer(customerId) {
  const { rows } = await pool.query(
    `SELECT s.*, p.scrap_type, p.approx_quantity, p.area
     FROM pickup_schedules s LEFT JOIN pickup_requests p ON p.id = s.source_request_id
     WHERE s.customer_id = $1 AND (s.active OR s.updated_at > NOW() - interval '30 days')
     ORDER BY s.active DESC, s.next_date`,
    [customerId]
  );
  return rows.map((r) => ({ ...r, next_date: toYmd(r.next_date), frequencyLabel: FREQUENCIES[r.frequency].label }));
}

async function setActive(customerId, scheduleId, active) {
  const { rows } = await pool.query(
    `UPDATE pickup_schedules SET active = $3, updated_at = NOW(),
       -- Resuming a schedule whose date has passed moves it to the next one ahead.
       next_date = CASE WHEN $3 AND next_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date + ${LEAD_DAYS}
                        THEN (NOW() AT TIME ZONE 'Asia/Kolkata')::date + ${LEAD_DAYS} ELSE next_date END
     WHERE id = $1 AND customer_id = $2 AND (frequency <> 'once' OR $3 = FALSE)
     RETURNING *`,
    [scheduleId, customerId, active]
  );
  return rows[0] || null;
}

async function remove(customerId, scheduleId) {
  const { rowCount } = await pool.query('DELETE FROM pickup_schedules WHERE id = $1 AND customer_id = $2', [scheduleId, customerId]);
  return rowCount > 0;
}

// Create the requests that are due. Each schedule is claimed by moving its
// date on (or switching a one-off off) in the same statement, so a request
// is never created twice even if two checks overlap.
async function runDue() {
  const dueBy = addDays(indiaToday(), LEAD_DAYS);
  const { rows: due } = await pool.query(
    'SELECT * FROM pickup_schedules WHERE active AND next_date <= $1 ORDER BY next_date LIMIT 50',
    [dueBy]
  );
  let created = 0;
  for (const schedule of due) {
    const date = toYmd(schedule.next_date);
    const following = nextAfter(date, schedule.frequency);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const claim = await client.query(
        `UPDATE pickup_schedules SET next_date = COALESCE($2::date, next_date), active = ($2::date IS NOT NULL), updated_at = NOW()
         WHERE id = $1 AND active AND next_date = $3::date RETURNING id`,
        [schedule.id, following, date]
      );
      if (!claim.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const { rows: source } = await client.query('SELECT * FROM pickup_requests WHERE id = $1', [schedule.source_request_id]);
      const s = source[0];
      if (!s) {
        // The original was deleted: nothing to copy, so stop this schedule.
        await client.query('UPDATE pickup_schedules SET active = FALSE WHERE id = $1', [schedule.id]);
        await client.query('COMMIT');
        continue;
      }
      const label = FREQUENCIES[schedule.frequency].label.toLowerCase();
      const { rows } = await client.query(
        `INSERT INTO pickup_requests
          (company_name, business_type, pickup_frequency, gstin, customer_id, name, phone, email, address, area, pincode,
           scrap_type, approx_quantity, item_quantities, notes, latitude, longitude, preferred_date,
           terms_accepted_at, terms_version, schedule_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,$20)
         RETURNING id`,
        [s.company_name, s.business_type, s.pickup_frequency, s.gstin, schedule.customer_id, s.name, s.phone, s.email,
          s.address, s.area, s.pincode, s.scrap_type, s.approx_quantity, s.item_quantities && JSON.stringify(s.item_quantities),
          `Repeat pickup (${label}, from request #${s.id}) for ${date}. Please confirm the quantity with the customer.`,
          s.latitude, s.longitude, date, schedule.terms_version, schedule.id]
      );
      await client.query('UPDATE pickup_schedules SET last_request_id = $2 WHERE id = $1', [schedule.id, rows[0].id]);
      await client.query('COMMIT');
      created++;
      live.publish('requests');
      live.publishToCustomer(schedule.customer_id);
      push.quietly(push.notifyAdmins({
        title: `Repeat pickup #${rows[0].id} 🔁`,
        body: `${s.company_name} · ${s.approx_quantity} · for ${date}`,
        url: `/admin.html#pickup-${rows[0].id}`,
        tag: `pickup-${rows[0].id}`,
      }));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`repeat pickup ${schedule.id} failed`, err);
    } finally {
      client.release();
    }
  }
  return created;
}

function start() {
  const run = () => runDue().catch((err) => console.error('Repeat pickups check failed:', err.message));
  setTimeout(run, 30 * 1000);
  setInterval(run, CHECK_EVERY_MS);
}

module.exports = {
  FREQUENCIES, LEAD_DAYS, dateRange, createSchedule, listForCustomer, setActive, remove, runDue, start, nextAfter,
};
