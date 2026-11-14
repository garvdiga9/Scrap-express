// The office runs a pickup itself with an outside truck (Porter, Delhivery...).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, adminLogin, staffLogin, makeRequest, twoSlots, cleanUp,
} = require('./helpers');
const dispatch = require('../lib/dispatch');

after(async () => { await cleanUp(); await pool.end(); });

async function booked(admin, staffId = null) {
  const r = await makeRequest({ status: 'accepted' });
  const o = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  await admin.post(`/api/admin/requests/${r.id}/book-slot`, { slotId: o.data.slots[0].id });
  if (staffId) await admin.put(`/api/admin/requests/${r.id}/staff`, { staffId });
  return { ...r, slots: o.data.slots };
}

test('an outside truck: off the staff list, the office marks every step', async () => {
  const admin = await adminLogin();
  const staff = await admin.post('/api/admin/staff', { name: 'Test Outside', username: 'testoutside', password: 'test-pass-1' });
  const r = await booked(admin, staff.data.id);

  assert.equal((await admin.put(`/api/admin/requests/${r.id}/outside`, { provider: 'Porter', phone: '12345' })).status, 400);
  assert.equal((await admin.put(`/api/admin/requests/${r.id}/outside`, {
    provider: 'Porter', driver: 'Raju', phone: '+91 98111 11111', vehicle: 'dl1la1234', fare: '1500',
  })).status, 200);
  const { rows: [row] } = await pool.query('SELECT staff_id, office_handled, outside_vehicle, outside_phone FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(row, {
    staff_id: null, office_handled: true, outside_vehicle: 'DL1LA1234', outside_phone: '9811111111',
  });

  const list = await (await staffLogin('testoutside', 'test-pass-1')).get('/api/staff/pickups');
  assert.ok(![...list.data.available, ...list.data.mine].some((p) => p.id === r.id), 'staff no longer see it');
  assert.equal(await dispatch.step(staff.data.id, r.id, 'on_way'), null, 'staff cannot do its steps');
  assert.equal((await dispatch.customerView([r.id])).get(r.id).staffName, 'Raju (Porter truck, DL1LA1234)');

  const base = `/api/admin/requests/${r.id}/office`;
  assert.equal((await admin.post(`${base}/step`, { step: 'on_way' })).data.status, 'on_way');
  assert.equal((await admin.post(`${base}/step`, { step: 'arrived' })).data.status, 'arrived');
  assert.equal((await admin.post(`${base}/weigh`, { quantities: [100, 2] })).data.status, 'weighed', 'the office may weigh without a photo');
  assert.equal((await admin.post(`${base}/paid`, { method: 'cash', amount: 4000 })).status, 400, 'a different amount needs a reason');
  assert.equal((await admin.post(`${base}/paid`, { method: 'cash', amount: 4000, note: 'Rounded' })).data.status, 'completed');

  const log = (await admin.get('/api/admin/activity')).data.map((a) => a.action);
  assert.ok(log.some((a) => a.startsWith('Sent an outside truck')) && log.some((a) => a.startsWith('Office marked paid')));
});

test('office steps are refused on a staff pickup; handing back ends office handling', async () => {
  const admin = await adminLogin();
  const staff = await admin.post('/api/admin/staff', { name: 'Test Back', username: 'testback', password: 'test-pass-1' });
  const r = await booked(admin, staff.data.id);
  assert.equal((await admin.post(`/api/admin/requests/${r.id}/office/step`, { step: 'on_way' })).status, 409);
  await admin.put(`/api/admin/requests/${r.id}/outside`, { provider: 'Delhivery' });
  await admin.put(`/api/admin/requests/${r.id}/staff`, { staffId: staff.data.id });
  const { rows: [row] } = await pool.query('SELECT staff_id, office_handled FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(row, { staff_id: staff.data.id, office_handled: false });
});

test('new times after an outside truck go back to staff, and reminders reset', async () => {
  const admin = await adminLogin();
  const r = await booked(admin);
  await admin.put(`/api/admin/requests/${r.id}/outside`, { provider: 'Porter' });
  await pool.query('UPDATE pickup_requests SET slots_reminded = TRUE WHERE id = $1', [r.id]);
  await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  const { rows: [row] } = await pool.query('SELECT office_handled, slots_reminded FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(row, { office_handled: false, slots_reminded: false });
});

test('the office books an offered time for the customer, only from that request', async () => {
  const admin = await adminLogin();
  const r = await makeRequest({ status: 'accepted' });
  const other = await makeRequest({ status: 'accepted' });
  const o = await admin.post(`/api/admin/requests/${r.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  const o2 = await admin.post(`/api/admin/requests/${other.id}/slots`, { slots: twoSlots(), deadlineHours: 24 });
  assert.equal((await admin.post(`/api/admin/requests/${r.id}/book-slot`, { slotId: o.data.slots[0].id })).status, 200);
  assert.equal((await admin.post(`/api/admin/requests/${r.id}/book-slot`, { slotId: o.data.slots[1].id })).status, 200, 'moved');
  assert.equal((await admin.post(`/api/admin/requests/${r.id}/book-slot`, { slotId: o2.data.slots[0].id })).status, 409);
  const { rows: [row] } = await pool.query('SELECT status, slot_id FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(row, { status: 'scheduled', slot_id: o.data.slots[1].id });
});
