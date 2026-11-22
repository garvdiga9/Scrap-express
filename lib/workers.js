// Workers, daily attendance and month-end pay (Admin → Workers).
//
// Attendance: each day a worker is marked present, half day, absent, paid
// leave or week off / holiday. At the month end, pay is worked out from it:
//   Daily wage:   wage × (present + ½ × half days + paid leave)
//                 (absent and week-off days are not paid)
//   Monthly wage: wage ÷ days in the month × paid days, where paid days =
//                 present + ½ × half days + paid leave + week off / holiday
//                 (absent and unmarked days are not paid)
// Days before the joining date are left out. Unmarked days are counted
// separately so the owner can mark them before paying.
const pool = require('../db/pool');
const { cleanPhone } = require('./validation');

const DEPARTMENTS = ['Pickup crew', 'Drivers', 'Yard & sorting', 'Office staff', 'Accounts', 'Managers', 'Other'];
const WAGE_TYPES = { daily: 'Per day', monthly: 'Per month' };
const STATUSES = {
  present: 'Present', half: 'Half day', absent: 'Absent', leave: 'Paid leave', off: 'Week off / holiday',
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_WAGE = 1000000;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysIn = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
// DATE columns arrive as local midnight: read the local date parts.
const ymd = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));
// Whole days from a to b, both included ('YYYY-MM-DD').
const spanDays = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1);

// The pay rule above, for one worker and one month.
// counts: { present, half, absent, leave, off }
function computePay(wageType, wage, counts, daysInMonth) {
  const c = {
    present: 0, half: 0, absent: 0, leave: 0, off: 0, ...counts,
  };
  const worked = c.present + c.half * 0.5;
  const paidDays = wageType === 'monthly' ? worked + c.leave + c.off : worked + c.leave;
  const perDay = wageType === 'monthly' ? Number(wage) / daysInMonth : Number(wage);
  return { paidDays, perDay: Math.round(perDay * 100) / 100, amount: Math.round(perDay * paidDays) };
}

// ---- workers ----

function validate(input) {
  const v = {
    name: text(input.name, 150),
    phone: text(input.phone, 20),
    department: DEPARTMENTS.includes(input.department) ? input.department : null,
    designation: text(input.designation, 100),
    wageType: WAGE_TYPES[input.wageType] ? input.wageType : null,
    wage: Number(input.wage),
    joinedOn: DATE_RE.test(input.joinedOn || '') ? input.joinedOn : null,
    active: input.active === undefined ? true : Boolean(input.active),
    notes: text(input.notes, 300),
  };
  if (!v.name) return { error: "Please enter the worker's name." };
  if (!v.department) return { error: 'Please choose a department.' };
  if (!v.wageType) return { error: 'Please choose daily or monthly wage.' };
  if (!Number.isFinite(v.wage) || v.wage < 0 || v.wage > MAX_WAGE) return { error: 'Please enter the wage in rupees.' };
  if (v.phone) {
    const phone = cleanPhone(v.phone);
    if (!phone) return { error: "The phone number doesn't look right." };
    v.phone = phone;
  }
  return { value: v };
}

// Managers see everything except wages.
const shape = (w, withWages) => ({
  id: w.id,
  name: w.name,
  phone: w.phone,
  department: w.department,
  designation: w.designation,
  joinedOn: w.joined_on ? ymd(w.joined_on) : null,
  active: w.active,
  notes: w.notes,
  ...(withWages ? { wageType: w.wage_type, wage: Number(w.wage) } : {}),
});

async function list({ withWages = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM workers ORDER BY active DESC, department, name');
  return rows.map((w) => shape(w, withWages));
}

async function save(id, input) {
  const { error, value: v } = validate(input);
  if (error) return { error };
  const params = [v.name, v.phone || null, v.department, v.designation || null, v.wageType, Math.round(v.wage * 100) / 100, v.joinedOn, v.active, v.notes || null];
  const { rows } = id
    ? await pool.query(
      `UPDATE workers SET name = $1, phone = $2, department = $3, designation = $4, wage_type = $5, wage = $6, joined_on = $7, active = $8, notes = $9
       WHERE id = $10 RETURNING *`,
      [...params, id]
    )
    : await pool.query(
      `INSERT INTO workers (name, phone, department, designation, wage_type, wage, joined_on, active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      params
    );
  return rows[0] ? { value: shape(rows[0], true) } : { error: 'Not found' };
}

// ---- attendance ----

// Everyone working on that day (joined by then, still active), with their mark.
async function attendanceFor(day) {
  if (!DATE_RE.test(day || '')) return { error: 'Please choose a date.' };
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.department, w.designation, a.status, a.marked_by, a.marked_at
     FROM workers w LEFT JOIN attendance a ON a.worker_id = w.id AND a.day = $1
     WHERE (w.active OR a.status IS NOT NULL) AND (w.joined_on IS NULL OR w.joined_on <= $1)
     ORDER BY w.department, w.name`,
    [day]
  );
  return {
    value: {
      day,
      workers: rows.map((r) => ({
        id: r.id, name: r.name, department: r.department, designation: r.designation, status: r.status, markedBy: r.marked_by, markedAt: r.marked_at,
      })),
    },
  };
}

// entries: [{ workerId, status }] (status null clears the mark).
async function mark(day, entries, markedBy) {
  if (!DATE_RE.test(day || '')) return { error: 'Please choose a date.' };
  if (day > today()) return { error: "Attendance can't be marked for a future date." };
  if (!Array.isArray(entries) || !entries.length) return { error: 'Nothing to save.' };
  const bad = entries.find((e) => e.status != null && !STATUSES[e.status]);
  if (bad) return { error: 'Please choose present, half day, absent, paid leave or week off.' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const workerId = Number(e.workerId);
      if (!Number.isInteger(workerId)) continue;
      if (e.status == null) {
        await client.query('DELETE FROM attendance WHERE worker_id = $1 AND day = $2', [workerId, day]);
      } else {
        await client.query(
          `INSERT INTO attendance (worker_id, day, status, marked_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (worker_id, day) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = NOW()`,
          [workerId, day, e.status, markedBy]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return attendanceFor(day);
}

// For the to-do list: active workers not yet marked today.
async function unmarkedToday() {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM workers w
     WHERE w.active AND (w.joined_on IS NULL OR w.joined_on <= $1)
       AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.worker_id = w.id AND a.day = $1)`,
    [today()]
  );
  return r.n;
}

// ---- month-end pay ----

async function payroll(month) {
  if (!MONTH_RE.test(month || '')) return { error: 'Please choose a month.' };
  const first = `${month}-01`;
  const days = daysIn(month);
  const last = `${month}-${String(days).padStart(2, '0')}`;
  const now = today();
  const { rows } = await pool.query(
    `SELECT w.*, a.status, COUNT(a.day)::int AS n
     FROM workers w LEFT JOIN attendance a ON a.worker_id = w.id AND a.day BETWEEN $1 AND $2
     WHERE (w.joined_on IS NULL OR w.joined_on <= $2)
       AND (w.active OR EXISTS (SELECT 1 FROM attendance x WHERE x.worker_id = w.id AND x.day BETWEEN $1 AND $2))
     GROUP BY w.id, a.status ORDER BY w.department, w.name`,
    [first, last]
  );
  const byWorker = new Map();
  rows.forEach((r) => {
    if (!byWorker.has(r.id)) byWorker.set(r.id, { w: r, counts: {} });
    if (r.status) byWorker.get(r.id).counts[r.status] = r.n;
  });
  const people = [...byWorker.values()].map(({ w, counts }) => {
    // Days that should have a mark: from joining (or the 1st) to today (or the month end).
    const from = w.joined_on && ymd(w.joined_on) > first ? ymd(w.joined_on) : first;
    const to = now < last ? now : last;
    const expected = to >= from ? spanDays(from, to) : 0;
    const marked = Object.values(counts).reduce((s, n) => s + n, 0);
    const pay = computePay(w.wage_type, w.wage, counts, days);
    return {
      id: w.id,
      name: w.name,
      department: w.department,
      designation: w.designation,
      wageType: w.wage_type,
      wage: Number(w.wage),
      counts: {
        present: 0, half: 0, absent: 0, leave: 0, off: 0, ...counts,
      },
      unmarked: Math.max(0, expected - marked),
      ...pay,
    };
  });
  const departments = DEPARTMENTS.map((name) => {
    const inDept = people.filter((p) => p.department === name);
    return { name, workers: inDept.length, amount: inDept.reduce((s, p) => s + p.amount, 0) };
  }).filter((d) => d.workers);
  return {
    value: {
      month, days, people, departments, total: people.reduce((s, p) => s + p.amount, 0), complete: last < now,
    },
  };
}

// The month's pay as a spreadsheet (CSV opens in Excel).
function payrollCsv(p) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Name', 'Department', 'Designation', 'Wage type', 'Wage (Rs)', 'Present', 'Half days', 'Paid leave', 'Week off / holiday', 'Absent', 'Unmarked', 'Paid days', 'Per day (Rs)', 'Amount (Rs)'];
  const lines = p.people.map((x) => [x.name, x.department, x.designation, WAGE_TYPES[x.wageType], x.wage, x.counts.present, x.counts.half, x.counts.leave, x.counts.off, x.counts.absent, x.unmarked, x.paidDays, x.perDay, x.amount]);
  p.departments.forEach((d) => lines.push([`Total: ${d.name}`, '', '', '', '', '', '', '', '', '', '', '', '', d.amount]));
  lines.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', p.total]);
  return [head, ...lines].map((r) => r.map(cell).join(',')).join('\r\n');
}

module.exports = {
  DEPARTMENTS, WAGE_TYPES, STATUSES, computePay, list, save, attendanceFor, mark, unmarkedToday, payroll, payrollCsv, today,
};
