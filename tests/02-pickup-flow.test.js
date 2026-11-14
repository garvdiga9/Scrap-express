// A pickup from quote to payment: slots, staff, weighing, paying, receipt,
// rating, cash with staff, changing and cancelling.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  JPEG, pool, adminLogin, staffLogin, customerLogin, makeRequest, twoSlots, indiaDay, client, cleanUp,
} = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

async function weigh(staff, id, quantities, bytes = JPEG) {
  const form = new FormData();
  form.append('quantities', JSON.stringify(quantities));
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'weigh.jpg');
  return staff.post(`/api/staff/pickups/${id}/weigh`, form);
}

test('a pickup from quote to paid, with two staff racing for it', async () => {
  const admin = await adminLogin();
  const customer = await customerLogin();
  const r = await makeRequest({ customerId: customer.id });

  assert.equal((await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 })).status, 409, 'no slots before the quote is accepted');
  assert.equal((await customer.post(`/api/customer/requests/${r.id}/quote`, { response: 'accept' })).status, 200);
  assert.equal((await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: [{ date: indiaDay(1), from: '15:00', to: '12:00' }] })).status, 400, 'end before start');
  const sent = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.slots.length, 2);
  assert.ok((await customer.page('/account')).includes('Choose your pickup slot'));

  assert.equal((await admin.post('/api/admin/staff', { name: 'Test Ravi', username: 'testravi', password: '123' })).status, 400, 'short password');
  const s1 = await admin.post('/api/admin/staff', { name: 'Test Ravi', username: 'testravi', password: 'test-pass-1', phone: '9811122244' });
  const s2 = await admin.post('/api/admin/staff', { name: 'Test Amit', username: 'testamit', password: 'test-pass-2' });
  assert.equal(s1.status, 201);
  assert.equal(s2.status, 201);
  assert.equal((await admin.post('/api/admin/staff', { name: 'X', username: 'testravi', password: 'abcdefgh' })).status, 400, 'username taken');
  assert.equal((await staffLogin('testravi', 'wrong')).status, 401);
  const ravi = await staffLogin('testravi', 'test-pass-1');
  const amit = await staffLogin('testamit', 'test-pass-2');
  assert.equal((await ravi.get('/api/admin/requests')).status, 401, 'staff cannot open admin data');

  assert.equal((await customer.post(`/api/customer/requests/${r.id}/slot`, { slotId: sent.data.slots[1].id })).status, 200);
  assert.notEqual((await customer.post(`/api/customer/requests/${r.id}/slot`, { slotId: sent.data.slots[0].id })).status, 200, 'cannot choose twice');
  const offer = (await ravi.get('/api/staff/pickups')).data.available.find((p) => p.id === r.id);
  assert.ok(offer, 'staff see the booked pickup');
  assert.equal(offer.phone, undefined, 'contact hidden until taken');
  assert.ok(Array.isArray((await ravi.get('/api/staff/pickups')).data.todo), 'staff get their to-do list');

  const [a, b] = await Promise.all([ravi.post(`/api/staff/pickups/${r.id}/claim`), amit.post(`/api/staff/pickups/${r.id}/claim`)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'only one can take it');
  const [winner, loser] = a.status === 200 ? [ravi, amit] : [amit, ravi];
  const mine = (await winner.get('/api/staff/pickups')).data.mine.find((p) => p.id === r.id);
  assert.equal(mine.phone, '9811122233');
  assert.equal((await loser.post(`/api/staff/pickups/${r.id}/step`, { step: 'on_way' })).status, 409);
  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/step`, { step: 'arrived' })).status, 409, 'no skipping steps');
  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/step`, { step: 'on_way' })).status, 200);
  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/step`, { step: 'arrived' })).status, 200);
  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/paid`, { method: 'cash' })).status, 409, 'no paying before weighing');

  assert.equal((await weigh(winner, r.id, [1850, 12], Buffer.from('not a photo'))).status, 400);
  assert.equal((await weigh(winner, r.id, [])).status, 400);
  assert.equal((await weigh(winner, r.id, [1850, 12])).status, 200);
  const { rows: [w] } = await pool.query('SELECT weighed_kg, amount_due FROM pickup_requests WHERE id = $1', [r.id]);
  assert.equal(Number(w.weighed_kg), 1862);
  assert.equal(Number(w.amount_due), 1850 * 30 + 12 * 600);

  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/paid`, { method: 'cash', amount: 62000 })).status, 400, 'a different amount needs a reason');
  assert.equal((await winner.post(`/api/staff/pickups/${r.id}/paid`, { method: 'cash', amount: 62000, note: 'Rounded off' })).status, 200);
  const receipt = await client().page(`/quote/${r.token}/receipt`);
  assert.ok(receipt.includes('Pickup Receipt') && receipt.includes('62,700') && receipt.includes('62,000') && receipt.includes('Rounded off'));
  const account = await customer.page('/account');
  assert.ok(account.includes('How was your pickup?'), 'customer is asked for a rating');

  // Rating: once, and publishable when allowed.
  assert.equal((await customer.post(`/api/customer/requests/${r.id}/rating`, { rating: 5, comment: 'Test: on time and fair weighing', allowPublic: true })).status, 200);
  assert.notEqual((await customer.post(`/api/customer/requests/${r.id}/rating`, { rating: 1 })).status, 200, 'only once');
  assert.equal((await admin.post(`/api/admin/ratings/${r.id}/publish`)).status, 200);
  await pool.query("UPDATE testimonials SET customer_name = 'Test Review' WHERE id = (SELECT review_id FROM pickup_requests WHERE id = $1)", [r.id]);

  // Cash with staff: given minus paid, then settled.
  const staffId = winner === ravi ? s1.data.id : s2.data.id;
  assert.equal((await admin.post('/api/admin/cash/give', { staffId, amount: 70000 })).status, 201);
  let card = (await admin.get('/api/admin/cash')).data.staff.find((s) => s.id === staffId);
  assert.equal(card.shouldHave, 8000);
  assert.equal((await admin.post('/api/admin/cash/settle', { staffId, returned: 7900 })).status, 201);
  card = (await admin.get('/api/admin/cash')).data.staff.find((s) => s.id === staffId);
  assert.equal(card ? card.shouldHave : 0, 0);
  const { rows: [settled] } = await pool.query("SELECT amount, expected FROM staff_cash WHERE staff_id = $1 AND kind = 'settled'", [staffId]);
  assert.equal(Number(settled.amount) - Number(settled.expected), -100, 'shortfall recorded');

  // A switched-off staff member is signed out at once.
  await admin.put(`/api/admin/staff/${s1.data.id}`, { name: 'Test Ravi', username: 'testravi', active: false });
  assert.equal((await ravi.get('/api/staff/pickups')).status, 401);
  assert.equal((await staffLogin('testravi', 'test-pass-1')).status, 401);
});

test('trucks per slot: a full slot cannot be chosen', async () => {
  const admin = await adminLogin();
  const saved = (await admin.get('/api/admin/board')).data.perSlot;
  try {
    assert.equal((await admin.put('/api/admin/board/settings', { perSlot: 1 })).status, 200);
    const first = await makeRequest({ status: 'accepted' });
    const second = await makeRequest({ status: 'accepted' });
    const slots = [{ date: indiaDay(3), from: '10:00', to: '13:00' }];
    const o1 = await admin.post(`/api/admin/requests/${first.id}/slots`, { slots, deadlineHours: 24 });
    const o2 = await admin.post(`/api/admin/requests/${second.id}/slots`, { slots, deadlineHours: 24 });
    assert.equal((await client().post(`/api/quote/${first.token}/slot`, { slotId: o1.data.slots[0].id })).status, 200);
    const full = await client().post(`/api/quote/${second.token}/slot`, { slotId: o2.data.slots[0].id });
    assert.equal(full.status, 409);
    assert.match(full.data.error, /filled up/);
    const day = (await admin.get('/api/admin/board?days=7')).data.days.find((d) => d.date === indiaDay(3));
    assert.ok(day.windows.some((w) => w.full));
  } finally {
    await admin.put('/api/admin/board/settings', { perSlot: saved || 2 });
  }
});

test('customers can move, ask for new times, or cancel before the team sets off', async () => {
  const admin = await adminLogin();
  const r = await makeRequest({ status: 'accepted' });
  const q = client();
  const o = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  await q.post(`/api/quote/${r.token}/slot`, { slotId: o.data.slots[0].id });
  assert.equal((await q.post(`/api/quote/${r.token}/reschedule`, { slotId: o.data.slots[1].id })).status, 200, 'moved');
  assert.equal((await q.post(`/api/quote/${r.token}/reschedule`, { newSlots: true })).status, 200, 'asked for new times');
  let { rows: [row] } = await pool.query('SELECT status FROM pickup_requests WHERE id = $1', [r.id]);
  assert.equal(row.status, 'accepted');
  const noReason = await q.post(`/api/quote/${r.token}/cancel`, { reason: '' });
  assert.notEqual(noReason.status, 200);
  assert.match(noReason.data.error, /why you are cancelling/, 'a reason is needed');
  assert.equal((await q.post(`/api/quote/${r.token}/cancel`, { reason: 'Test: sold elsewhere' })).status, 200);
  ({ rows: [row] } = await pool.query('SELECT status, cancelled_by FROM pickup_requests WHERE id = $1', [r.id]));
  assert.deepEqual(row, { status: 'cancelled', cancelled_by: 'customer' });

  const late = await makeRequest({ status: 'on_way' });
  assert.equal((await client().post(`/api/quote/${late.token}/cancel`, { reason: 'too late' })).status, 409, 'not once the team is on the way');
});
