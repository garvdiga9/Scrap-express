// Reminders, so nothing waits too long:
//  - the admin's to-do list (top of the dashboard) and a morning summary alert
//  - each staff member's to-do list (top of the Staff app) and a morning alert
//    with their pickups for the day
//  - customers: a nudge before the time to choose a slot runs out, and when a
//    quote has gone unanswered for two days (app, email and WhatsApp)
const pool = require('../db/pool');
const push = require('./push');
const notify = require('./notify');
const cash = require('./cash');
const settings = require('./settings');

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const TODAY = "(NOW() AT TIME ZONE 'Asia/Kolkata')::date";

// ---- the admin ----

// [{ key, level: 'urgent' | 'normal', text, tab, count }], most urgent first.
async function adminTasks() {
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const [
    newPickups, newDemolitions, callbacks, quotesWaiting, needSlots, slotsExpired, unassigned, officeSteps,
    photoChecks, bankToPay, lowRatings, toPublish, enquiries,
  ] = await Promise.all([
    one("SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest FROM pickup_requests WHERE status = 'pending'"),
    one("SELECT COUNT(*)::int AS n FROM demolition_requests WHERE status = 'pending'"),
    one("SELECT COUNT(*)::int AS n FROM callback_requests WHERE status = 'pending'"),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE status = 'quoted' AND quoted_at < NOW() - interval '2 days'"),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE status IN ('accepted', 'ready')"),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE status = 'slots_sent' AND slots_deadline < NOW()"),
    one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE s.slot_date <= ${TODAY} + 1)::int AS soon
         FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
         WHERE p.status = 'scheduled' AND p.staff_id IS NULL AND NOT p.office_handled`),
    one(`SELECT COUNT(*)::int AS n FROM pickup_requests p LEFT JOIN pickup_slots s ON s.id = p.slot_id
         WHERE p.office_handled AND p.status IN ('scheduled', 'on_way', 'arrived', 'weighed')
           AND (s.slot_date IS NULL OR s.slot_date <= ${TODAY})`),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE weigh_warnings IS NOT NULL AND weighed_at > NOW() - interval '3 days'"),
    one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_paid), 0) AS total FROM pickup_requests WHERE payment_method = 'bank' AND status = 'completed' AND bank_paid_at IS NULL"),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE rating <= 2 AND rated_at > NOW() - interval '7 days'"),
    one("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE rating_public AND rating >= 4 AND COALESCE(rating_comment, '') <> '' AND review_id IS NULL"),
    one("SELECT COUNT(*)::int AS n FROM lot_enquiries WHERE status = 'new'"),
  ]);
  const staffCash = (await cash.staffSummary()).filter((s) => s.shouldHave > 0);

  const tasks = [];
  const add = (key, level, count, text, tab) => { if (count) tasks.push({ key, level, count, text, tab }); };
  add('unassigned', unassigned.soon ? 'urgent' : 'normal', unassigned.n,
    `${plural(unassigned.n, 'booked pickup')} with no staff member yet${unassigned.soon ? ` (${unassigned.soon} today or tomorrow)` : ''}. Assign someone, or send an outside truck.`, 'board');
  add('office', 'urgent', officeSteps.n, `${plural(officeSteps.n, 'pickup')} you run (outside truck or drop-off) need${officeSteps.n === 1 ? 's' : ''} the next step marked.`, 'board');
  add('new', newPickups.oldest && Date.now() - new Date(newPickups.oldest) > 24 * 3600e3 ? 'urgent' : 'normal', newPickups.n,
    `${plural(newPickups.n, 'new pickup request')} waiting for your quote.`, 'requests');
  add('slots', 'urgent', needSlots.n, `${plural(needSlots.n, 'customer')} accepted your quote. Send them pickup or drop-off times.`, 'requests');
  add('expired', 'urgent', slotsExpired.n, `${plural(slotsExpired.n, 'customer')} didn't choose a time before the deadline. Call them or send new times.`, 'requests');
  add('bank', 'urgent', bankToPay.n, `${plural(bankToPay.n, 'bank transfer')} to make to customers (${inr(bankToPay.total)}).`, 'money');
  if (staffCash.length) {
    tasks.push({
      key: 'cash',
      level: 'normal',
      count: staffCash.length,
      text: `Cash with staff: ${staffCash.map((s) => `${s.name.split(' ')[0]} ${inr(s.shouldHave)}`).join(', ')}. Settle up when they hand it back.`,
      tab: 'money',
    });
  }
  add('photo', 'urgent', photoChecks.n, `${plural(photoChecks.n, 'weighing photo')} flagged (old, far from the site or without a location). Please check.`, 'requests');
  add('low', 'urgent', lowRatings.n, `${plural(lowRatings.n, 'low rating')} this week. Call the customer to sort it out.`, 'testimonials');
  add('demolition', 'normal', newDemolitions.n, `${plural(newDemolitions.n, 'new demolition request')} to look at.`, 'demolition');
  add('callbacks', 'normal', callbacks.n, `${plural(callbacks.n, 'customer')} asked for a call back.`, 'callbacks');
  add('quoted', 'normal', quotesWaiting.n, `${plural(quotesWaiting.n, 'quote')} sent over 2 days ago with no answer. A quick call can help.`, 'requests');
  add('enquiries', 'normal', enquiries.n, `${plural(enquiries.n, 'new enquiry', 'new enquiries')} for your lots for sale.`, 'lots');
  add('publish', 'normal', toPublish.n, `${plural(toPublish.n, 'good rating')} you can show on the website.`, 'testimonials');
  return tasks.sort((a, b) => (a.level === b.level ? 0 : a.level === 'urgent' ? -1 : 1));
}

// ---- staff ----

async function staffTasks(staffId) {
  const [{ rows: today }, { rows: unfinished }, { rows: [open] }, summary] = await Promise.all([
    pool.query(
      `SELECT p.id, p.company_name, p.area, s.time_from FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
       WHERE p.staff_id = $1 AND p.status = 'scheduled' AND s.slot_date = ${TODAY} ORDER BY s.time_from`,
      [staffId]
    ),
    pool.query("SELECT id, status, company_name FROM pickup_requests WHERE staff_id = $1 AND status IN ('on_way', 'arrived', 'weighed') ORDER BY id", [staffId]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
       WHERE p.status = 'scheduled' AND p.staff_id IS NULL AND NOT p.office_handled AND s.slot_date <= ${TODAY} + 1`
    ),
    cash.staffSummary(),
  ]);
  const clock = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const NEXT = { on_way: "mark \"I've arrived\"", arrived: 'enter the weight and photo', weighed: 'mark how it was paid' };
  const tasks = [];
  unfinished.forEach((p) => tasks.push({ level: 'urgent', text: `Pickup #${p.id} (${p.company_name}): ${NEXT[p.status]}.` }));
  if (today.length) {
    tasks.push({ level: 'normal', text: `Today: ${today.map((p) => `${clock(p.time_from)} ${p.company_name}`).join(', ')}.` });
  }
  if (open.n) tasks.push({ level: 'normal', text: `${plural(open.n, 'pickup')} for today or tomorrow still need${open.n === 1 ? 's' : ''} someone. Take it below if you're free.` });
  const mine = summary.find((s) => s.id === staffId);
  if (mine && mine.shouldHave > 0) tasks.push({ level: 'normal', text: `Office cash with you: ${inr(mine.shouldHave)}. Hand back what's left and settle up with the office.` });
  return tasks;
}

// ---- timed reminders ----

const indiaNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
};

const SENT_KEY = 'reminders_sent';
const ADMIN_HOUR = 9;
const STAFF_HOUR = 8;

async function morningAdmin() {
  const tasks = await adminTasks();
  if (!tasks.length) return;
  const urgent = tasks.filter((t) => t.level === 'urgent').length;
  await push.notifyAdmins({
    title: `Good morning: ${plural(tasks.length, 'thing')} to do${urgent ? ` (${urgent} urgent)` : ''}`,
    body: tasks.slice(0, 3).map((t) => t.text).join(' '),
    url: '/admin.html',
    tag: 'morning-todo',
  });
}

async function morningStaff() {
  const { rows } = await pool.query(
    `SELECT p.staff_id, COUNT(*)::int AS n, MIN(s.time_from) AS first
     FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
     WHERE p.status = 'scheduled' AND p.staff_id IS NOT NULL AND s.slot_date = ${TODAY}
     GROUP BY p.staff_id`
  );
  await Promise.all(rows.map((r) => push.notifyStaff({
    title: `Today: ${plural(r.n, 'pickup')} 🚚`,
    body: `Your first is at ${String(r.first).slice(0, 5)}. Open the app for the addresses.`,
    url: '/staff.html',
    tag: 'morning-pickups',
  }, { onlyId: r.staff_id })));
  const { rows: [open] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pickup_requests p JOIN pickup_slots s ON s.id = p.slot_id
     WHERE p.status = 'scheduled' AND p.staff_id IS NULL AND NOT p.office_handled AND s.slot_date = ${TODAY}`
  );
  if (open.n) {
    await push.notifyStaff({
      title: `${plural(open.n, 'pickup')} today with nobody yet`,
      body: "If you're free, open the app and take it.",
      url: '/staff.html',
      tag: 'morning-open',
    });
  }
}

// Customers: the slot deadline is close, or a quote has waited two days.
async function customerNudges() {
  const { rows: closing } = await pool.query(
    `UPDATE pickup_requests SET slots_reminded = TRUE
     WHERE status = 'slots_sent' AND NOT slots_reminded AND slots_deadline > NOW() AND slots_deadline < NOW() + interval '3 hours'
     RETURNING id, customer_id, quote_token, delivery_mode, slots_deadline`
  );
  closing.forEach((r) => {
    const by = new Date(r.slots_deadline).toLocaleString('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    });
    const what = r.delivery_mode === 'self' ? 'when you will bring the scrap' : 'your pickup time';
    push.quietly(push.notifyRequest(r, {
      title: 'Reminder: choose a time ⏰', body: `Request #${r.id}: please choose ${what} by ${by}.`, url: r.quote_token ? `/quote/${r.quote_token}` : '/account', tag: `pickup-${r.id}`,
    }));
    notify.quietly('slots_reminder', r.id, { deadlineText: by });
  });
  const { rows: waiting } = await pool.query(
    `UPDATE pickup_requests SET quote_reminded = TRUE
     WHERE status = 'quoted' AND NOT quote_reminded AND quoted_at < NOW() - interval '2 days' AND quoted_at > NOW() - interval '10 days'
     RETURNING id, customer_id, quote_token`
  );
  waiting.forEach((r) => {
    push.quietly(push.notifyRequest(r, {
      title: 'Your quote is waiting', body: `Request #${r.id}: please accept or decline our quote, or call us with questions.`, url: r.quote_token ? `/quote/${r.quote_token}` : '/account', tag: `pickup-${r.id}`,
    }));
    notify.quietly('quote_reminder', r.id);
  });
  return closing.length + waiting.length;
}

async function tick() {
  await customerNudges();
  const { day, hour } = indiaNow();
  // claim() lets exactly one run per day through, even across restarts.
  if (hour >= ADMIN_HOUR && hour < ADMIN_HOUR + 3 && await settings.claim(`${SENT_KEY}_admin`, day)) await morningAdmin();
  if (hour >= STAFF_HOUR && hour < STAFF_HOUR + 3 && await settings.claim(`${SENT_KEY}_staff`, day)) await morningStaff();
}

function start() {
  const run = () => tick().catch((err) => console.error('Reminders failed:', err.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = {
  adminTasks, staffTasks, customerNudges, morningAdmin, morningStaff, start,
};
