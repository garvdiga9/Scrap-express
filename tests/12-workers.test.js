// Workers: the pay rule, attendance marking, month-end pay, and who sees wages.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE, pool, adminLogin, client, cleanUp,
} = require('./helpers');
const { computePay } = require('../lib/workers');

after(async () => { await cleanUp(); await pool.end(); });

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('the pay rule: daily wage by days worked, monthly wage by paid days', () => {
  // 20 present, 2 half days, 1 paid leave, 3 absent, 4 week offs, at ₹500 a day.
  const daily = computePay('daily', 500, {
    present: 20, half: 2, leave: 1, absent: 3, off: 4,
  }, 30);
  assert.equal(daily.paidDays, 22, 'week offs and absences are not paid for daily wages');
  assert.equal(daily.amount, 11000);
  // ₹15,000 a month, 30 days: 24 present, 4 week offs, 2 half days.
  const monthly = computePay('monthly', 15000, { present: 24, off: 4, half: 2 }, 30);
  assert.equal(monthly.paidDays, 29);
  assert.equal(monthly.perDay, 500);
  assert.equal(monthly.amount, 14500);
  assert.equal(computePay('monthly', 15000, {}, 30).amount, 0, 'nothing marked, nothing paid');
});

test('workers, attendance and month-end pay; managers mark attendance but never see wages', async () => {
  assert.equal((await client().get('/api/admin/workers')).status, 401);
  const owner = await adminLogin();
  assert.equal((await owner.post('/api/admin/workers', { name: '', department: 'Pickup crew', wageType: 'daily', wage: 600 })).status, 400, 'name needed');
  assert.equal((await owner.post('/api/admin/workers', { name: 'Test Loader', department: 'Space', wageType: 'daily', wage: 600 })).status, 400, 'known departments');
  const made = await owner.post('/api/admin/workers', {
    name: 'Test Loader', department: 'Pickup crew', designation: 'Loader', wageType: 'daily', wage: 600, phone: '9811122288',
  });
  assert.equal(made.status, 201, made.data.error);
  const office = await owner.post('/api/admin/workers', {
    name: 'Test Accountant', department: 'Accounts', designation: 'Accountant', wageType: 'monthly', wage: 30000,
  });
  assert.equal(office.status, 201);

  const day = today();
  const future = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  assert.equal((await owner.put('/api/admin/attendance', { date: future, entries: [{ workerId: made.data.id, status: 'present' }] })).status, 400, 'no future dates');
  assert.equal((await owner.put('/api/admin/attendance', { date: day, entries: [{ workerId: made.data.id, status: 'sleeping' }] })).status, 400);

  // A manager marks today's attendance.
  assert.equal((await owner.post('/api/admin/team', { name: 'Test Supervisor', username: 'testsupervisor', password: 'sup-pass-123' })).status, 201);
  const res = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'testsupervisor', password: 'sup-pass-123' }) });
  await res.text();
  const mgr = client(res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid')));
  const seen = (await mgr.get('/api/admin/workers')).data.workers.find((w) => w.id === made.data.id);
  assert.ok(seen, 'managers see the workers');
  assert.equal(seen.wage, undefined, 'but not their wages');
  assert.equal((await mgr.post('/api/admin/workers', { name: 'Test X', department: 'Other', wageType: 'daily', wage: 1 })).status, 403);
  assert.equal((await mgr.get(`/api/admin/payroll?month=${day.slice(0, 7)}`)).status, 403, 'pay is owner only');
  assert.equal((await mgr.get(`/api/admin/payroll.csv?month=${day.slice(0, 7)}`)).status, 403);
  const marked = await mgr.put('/api/admin/attendance', {
    date: day, entries: [{ workerId: made.data.id, status: 'present' }, { workerId: office.data.id, status: 'half' }],
  });
  assert.equal(marked.status, 200, marked.data.error);
  assert.equal(marked.data.workers.find((w) => w.id === made.data.id).status, 'present');
  assert.equal(marked.data.workers.find((w) => w.id === made.data.id).markedBy, 'Test Supervisor');

  const pay = await owner.get(`/api/admin/payroll?month=${day.slice(0, 7)}`);
  assert.equal(pay.status, 200);
  const loader = pay.data.people.find((p) => p.id === made.data.id);
  assert.equal(loader.counts.present, 1);
  assert.equal(loader.amount, 600, 'one day at ₹600');
  const acct = pay.data.people.find((p) => p.id === office.data.id);
  assert.equal(acct.amount, Math.round((30000 / pay.data.days) * 0.5), 'half a day of a monthly wage');
  assert.ok(pay.data.departments.some((d) => d.name === 'Accounts'), 'pay is split by department');

  const csv = await owner.get(`/api/admin/payroll.csv?month=${day.slice(0, 7)}`);
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes('Test Loader') && csv.text.includes('TOTAL'));

  // Clearing a mark.
  const cleared = await owner.put('/api/admin/attendance', { date: day, entries: [{ workerId: made.data.id, status: null }] });
  assert.equal(cleared.data.workers.find((w) => w.id === made.data.id).status, null);
});
