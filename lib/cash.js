// Money check. Staff pay customers in cash from money the owner hands them;
// bank transfers are paid by the office afterwards.
//  - For each staff member since their last settle-up: cash given to them,
//    cash they paid to customers, and what they should still have.
//  - "Settle up" records the cash they hand back and any difference, and
//    starts the next period.
//  - Bank transfers still to pay, ticked off with the payment reference.
const pool = require('../db/pool');

const round2 = (n) => Math.round(n * 100) / 100;

// The open period for each staff member (after their last settle-up).
async function staffSummary() {
  const { rows: staff } = await pool.query(
    `SELECT s.id, s.name, s.active,
            (SELECT MAX(created_at) FROM staff_cash c WHERE c.staff_id = s.id AND c.kind = 'settled') AS last_settled
     FROM staff_users s ORDER BY s.active DESC, s.name`
  );
  const out = [];
  for (const s of staff) {
    const since = s.last_settled || new Date(0);
    const [{ rows: given }, { rows: paid }] = await Promise.all([
      pool.query(
        `SELECT id, amount, note, created_at FROM staff_cash
         WHERE staff_id = $1 AND kind = 'given' AND created_at > $2 ORDER BY created_at`,
        [s.id, since]
      ),
      pool.query(
        `SELECT id, company_name, amount_paid, paid_at FROM pickup_requests
         WHERE staff_id = $1 AND payment_method = 'cash' AND status = 'completed' AND paid_at > $2 ORDER BY paid_at`,
        [s.id, since]
      ),
    ]);
    const givenTotal = round2(given.reduce((sum, g) => sum + Number(g.amount), 0));
    const paidTotal = round2(paid.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0));
    if (!s.active && !given.length && !paid.length) continue;
    out.push({
      id: s.id,
      name: s.name,
      since: s.last_settled,
      given: given.map((g) => ({ ...g, amount: Number(g.amount) })),
      paid: paid.map((p) => ({ ...p, amount_paid: Number(p.amount_paid) })),
      givenTotal,
      paidTotal,
      shouldHave: round2(givenTotal - paidTotal),
    });
  }
  return out;
}

const parseAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? round2(n) : null;
};

// Cash handed to a staff member. Returns { entry } or { error }.
async function giveCash(staffId, amount, note, by) {
  if (!Number.isInteger(staffId)) return { error: 'Please choose a staff member.' };
  const value = parseAmount(amount);
  if (!value) return { error: 'Please enter the amount of cash you gave.' };
  const { rows } = await pool.query(
    `INSERT INTO staff_cash (staff_id, kind, amount, note, created_by)
     SELECT id, 'given', $2, $3, $4 FROM staff_users WHERE id = $1 RETURNING *`,
    [staffId, value, String(note ?? '').trim().slice(0, 200) || null, by]
  );
  return rows[0] ? { entry: rows[0] } : { error: 'That staff member no longer exists.' };
}

// Close the period: the cash they handed back, and how far off it was.
async function settle(staffId, returned, note, by) {
  if (!Number.isInteger(staffId)) return { error: 'Please choose a staff member.' };
  const value = parseAmount(returned);
  if (value == null) return { error: 'Please enter the cash they handed back (0 if none).' };
  const summary = (await staffSummary()).find((s) => s.id === staffId);
  if (!summary) return { error: 'That staff member no longer exists.' };
  const difference = round2(value - summary.shouldHave);
  const { rows } = await pool.query(
    `INSERT INTO staff_cash (staff_id, kind, amount, expected, difference, note, created_by)
     VALUES ($1, 'settled', $2, $3, $4, $5, $6) RETURNING *`,
    [staffId, value, summary.shouldHave, difference, String(note ?? '').trim().slice(0, 200) || null, by]
  );
  return { entry: rows[0] };
}

async function settlements(limit = 30) {
  const { rows } = await pool.query(
    `SELECT c.*, s.name FROM staff_cash c JOIN staff_users s ON s.id = c.staff_id
     WHERE c.kind = 'settled' ORDER BY c.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    ...r, amount: Number(r.amount), expected: Number(r.expected), difference: Number(r.difference),
  }));
}

// Bank transfers the office still has to make, and the latest ones made.
async function bankPayments() {
  const { rows } = await pool.query(
    `SELECT p.id, p.company_name, p.name, p.phone, p.amount_paid, p.paid_at, p.bank_reference, p.bank_paid_at, u.name AS staff_name
     FROM pickup_requests p LEFT JOIN staff_users u ON u.id = p.staff_id
     WHERE p.payment_method = 'bank' AND p.status = 'completed'
       AND (p.bank_paid_at IS NULL OR p.bank_paid_at > NOW() - interval '30 days')
     ORDER BY p.bank_paid_at IS NOT NULL, p.paid_at`
  );
  return rows.map((r) => ({ ...r, amount_paid: Number(r.amount_paid) }));
}

async function markTransferred(requestId, reference) {
  const ref = String(reference ?? '').trim().slice(0, 100);
  if (!ref) return { error: 'Please enter the payment reference (UTR or cheque number).' };
  const { rows } = await pool.query(
    `UPDATE pickup_requests SET bank_reference = $2, bank_paid_at = NOW()
     WHERE id = $1 AND payment_method = 'bank' AND status = 'completed' AND bank_paid_at IS NULL
     RETURNING id, customer_id, quote_token, amount_paid`,
    [requestId, ref]
  );
  return rows[0] ? { request: rows[0] } : { error: 'That payment was already marked, or is not a bank transfer.' };
}

// Today's and this month's money, for the top of the tab.
async function totals() {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(amount_paid) FILTER (WHERE payment_method = 'cash' AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS cash_today,
       COALESCE(SUM(amount_paid) FILTER (WHERE payment_method = 'bank' AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS bank_today,
       COALESCE(SUM(weighed_kg) FILTER (WHERE (paid_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS kg_today,
       COALESCE(SUM(amount_paid) FILTER (WHERE date_trunc('month', paid_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata')), 0) AS paid_month,
       COALESCE(SUM(weighed_kg) FILTER (WHERE date_trunc('month', paid_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata')), 0) AS kg_month,
       COALESCE(SUM(amount_paid) FILTER (WHERE payment_method = 'bank' AND bank_paid_at IS NULL), 0) AS bank_to_pay
     FROM pickup_requests WHERE status = 'completed' AND paid_at IS NOT NULL`
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

module.exports = {
  staffSummary, giveCash, settle, settlements, bankPayments, markTransferred, totals,
};
