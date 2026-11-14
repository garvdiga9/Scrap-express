// Drop-offs (the customer sends the scrap), the yard and contact person,
// reminders, and app alerts from the private quote link.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, adminLogin, staffLogin, makeRequest, twoSlots, client, cleanUp,
} = require('./helpers');
const dispatch = require('../lib/dispatch');
const reminders = require('../lib/reminders');
const notify = require('../lib/notify');

let savedYard = null;
after(async () => {
  if (savedYard) await (await adminLogin()).put('/api/admin/board/yard', savedYard);
  await cleanUp();
  await pool.end();
});

test('yard address and contact person: checked, then shown as soon as the quote is accepted', async () => {
  const admin = await adminLogin();
  savedYard = (await admin.get('/api/admin/board/yard')).data;
  assert.equal((await admin.put('/api/admin/board/yard', { address: 'x', map: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin.put('/api/admin/board/yard', { address: 'x', pocPhone: '12345' })).status, 400);
  const saved = await admin.put('/api/admin/board/yard', {
    address: 'Test Yard, Okhla Phase 1', hours: 'Mon–Sat, 9 AM – 6 PM', map: 'https://maps.app.goo.gl/test', pocName: 'Suresh', pocPhone: '+91 98111 22334',
  });
  assert.equal(saved.data.pocPhone, '9811122334');

  const r = await makeRequest({ status: 'quoted', mode: 'self', items: [{ material: 'Paper', rate: 14, unit: 'per kg' }] });
  const q = client();
  assert.ok(!(await q.page(`/quote/${r.token}`)).includes('Where to bring your scrap'), 'not before accepting');
  assert.equal((await q.post(`/api/quote/${r.token}/quote`, { response: 'accept' })).status, 200);
  const page = await q.page(`/quote/${r.token}`);
  assert.ok(page.includes('Where to bring your scrap') && page.includes('Test Yard, Okhla Phase 1') && page.includes('tel:+919811122334'));
  assert.ok((await q.page(`/quote/${r.token}?lang=hi`)).includes('स्क्रैप कहां लाना है'));
  const text = (await admin.get(`/api/admin/requests/${r.id}/update-text`)).data.text || '';
  assert.match(text, /Suresh/, 'the hand-sent WhatsApp has the contact person');
});

test('a drop-off from booking to paid, run by the office', async () => {
  const admin = await adminLogin();
  const r = await makeRequest({ status: 'accepted', mode: 'self', items: [{ material: 'Paper', rate: 14, unit: 'per kg' }] });
  const q = client();
  const sent = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  assert.ok((await q.page(`/quote/${r.token}`)).includes('Choose when you will bring the scrap'));
  assert.equal((await q.post(`/api/quote/${r.token}/slot`, { slotId: sent.data.slots[0].id })).status, 200);

  const staff = await admin.post('/api/admin/staff', { name: 'Test Drop', username: 'testdrop', password: 'test-pass-1' });
  const list = await (await staffLogin('testdrop', 'test-pass-1')).get('/api/staff/pickups');
  assert.ok(![...list.data.available, ...list.data.mine].some((p) => p.id === r.id), 'staff never see a drop-off');
  assert.equal(await dispatch.assign(r.id, staff.data.id), null, 'cannot be given to staff');
  assert.equal(await dispatch.useOutsideTruck(r.id, { provider: 'Porter' }), null, 'or to an outside truck');

  let page = await q.page(`/quote/${r.token}`);
  assert.ok(/Sent My Scrap/.test(page) && page.includes('Drop-off time chosen'));
  assert.equal((await q.post(`/api/quote/${r.token}/sent`, { note: 'Porter, DL1LA1234' })).status, 200);
  assert.equal((await q.post(`/api/quote/${r.token}/sent`, { note: 'again' })).status, 409);
  page = await q.page(`/quote/${r.token}`);
  assert.ok(page.includes('sent the scrap (Porter, DL1LA1234)'));

  const base = `/api/admin/requests/${r.id}/office`;
  assert.equal((await admin.post(`${base}/step`, { step: 'arrived' })).data.status, 'arrived');
  assert.equal((await admin.post(`${base}/weigh`, { quantities: [640] })).data.status, 'weighed');
  assert.equal((await admin.post(`${base}/paid`, { method: 'cash', amount: '' })).data.status, 'completed');
  const { rows: [done] } = await pool.query('SELECT amount_paid FROM pickup_requests WHERE id = $1', [r.id]);
  assert.equal(Number(done.amount_paid), 640 * 14);
  const receipt = await q.page(`/quote/${r.token}/receipt`);
  assert.ok(receipt.includes('Drop-off Receipt') && receipt.includes('Received from'));
});

test('"none of these times work" keeps a drop-off a drop-off', async () => {
  const admin = await adminLogin();
  const r = await makeRequest({ status: 'accepted', mode: 'self' });
  const o = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  await client().post(`/api/quote/${r.token}/slot`, { slotId: o.data.slots[0].id });
  assert.equal((await client().post(`/api/quote/${r.token}/reschedule`, { newSlots: true })).status, 200);
  const { rows: [row] } = await pool.query('SELECT status, office_handled FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(row, { status: 'accepted', office_handled: true });
});

test('reminders: to-do lists, and customer nudges sent once each', async () => {
  const admin = await adminLogin();
  await makeRequest({ status: 'pending' });
  const todo = (await admin.get('/api/admin/todo')).data;
  assert.ok(todo.some((t) => t.key === 'new'), 'new request on the admin to-do list');

  const closing = await makeRequest({ status: 'slots_sent' });
  await pool.query("UPDATE pickup_requests SET slots_deadline = NOW() + interval '2 hours', slots_reminded = FALSE WHERE id = $1", [closing.id]);
  const waiting = await makeRequest({ status: 'quoted' });
  await pool.query("UPDATE pickup_requests SET quoted_at = NOW() - interval '3 days', quote_reminded = FALSE WHERE id = $1", [waiting.id]);
  assert.ok((await reminders.customerNudges()) >= 2);
  const { rows } = await pool.query('SELECT slots_reminded, quote_reminded FROM pickup_requests WHERE id = ANY($1) ORDER BY id', [[closing.id, waiting.id]]);
  assert.equal(rows[0].slots_reminded, true);
  assert.equal(rows[1].quote_reminded, true);
  const again = await pool.query("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE company_name LIKE 'Test %' AND ((status = 'slots_sent' AND NOT slots_reminded AND slots_deadline < NOW() + interval '3 hours') OR (status = 'quoted' AND NOT quote_reminded AND quoted_at < NOW() - interval '2 days'))");
  assert.equal(again.rows[0].n, 0, 'nothing left to nudge twice');

  // A revised quote can be reminded again.
  assert.equal((await admin.put(`/api/admin/requests/${waiting.id}/quote`, { items: [{ material: 'Iron', rate: 31, unit: 'per kg' }] })).status, 200);
  const { rows: [rq] } = await pool.query('SELECT quote_reminded FROM pickup_requests WHERE id = $1', [waiting.id]);
  assert.equal(rq.quote_reminded, false);
});

test('messages: drop-off wording, and no yard message for normal pickups', () => {
  const yard = { address: 'Test Yard', pocName: 'Suresh', pocPhone: '9811122334' };
  const drop = notify.MESSAGES.drop_info({ id: 1, delivery_mode: 'self', yard });
  assert.match(drop.text, /Test Yard/);
  assert.match(drop.text, /Suresh, \+91 9811122334/);
  assert.equal(notify.MESSAGES.drop_info({ id: 1, delivery_mode: 'pickup', yard }), null);
  assert.match(notify.MESSAGES.slots_sent({ id: 1, delivery_mode: 'self' }).subject, /bring your scrap/);
});

test('app alerts from the quote link: real links only', async () => {
  const r = await makeRequest();
  assert.equal((await client().post(`/api/quote/${r.token}/push/status`, { endpoint: 'https://example.invalid/x' })).data.on, false);
  assert.equal((await client().post(`/api/quote/${'0'.repeat(48)}/push/status`, { endpoint: 'x' })).status, 404);
});
