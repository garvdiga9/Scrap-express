// A manager's important changes wait for the owner: nothing goes live until
// approved; rejected changes never apply; passwords are never stored.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE, pool, adminLogin, staffLogin, client, cleanUp,
} = require('./helpers');

after(async () => {
  await pool.query("DELETE FROM pending_changes WHERE requested_by_name LIKE 'Test %'");
  await pool.query("DELETE FROM scrap_categories WHERE name LIKE 'Test %'");
  await cleanUp();
  await pool.end();
});

async function manager() {
  const owner = await adminLogin();
  const made = await owner.post('/api/admin/team', { name: 'Test Approver Mgr', username: 'testapprmgr', password: 'mgr-pass-456' });
  assert.equal(made.status, 201, made.data.error);
  const res = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'testapprmgr', password: 'mgr-pass-456' }) });
  await res.text();
  return { owner, mgr: client(res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid'))) };
}

test('rates, staff and yard changes by a manager wait for the owner', async () => {
  const { owner, mgr } = await manager();

  // The owner's own change applies at once.
  const rate = await owner.post('/api/admin/rates', { name: 'Test Brass', price: 300, unit: 'kg', category: 'non-ferrous' });
  assert.equal(rate.status, 201, rate.data.error);

  // A manager's price change waits.
  assert.equal((await mgr.put(`/api/admin/rates/${rate.data.id}`, { price: -1 })).status, 400, 'mistakes are caught at once');
  const asked = await mgr.put(`/api/admin/rates/${rate.data.id}`, { price: 340 });
  assert.equal(asked.status, 202);
  assert.equal(asked.data.pending, true);
  const price = async () => Number((await pool.query('SELECT price FROM scrap_categories WHERE id = $1', [rate.data.id])).rows[0].price);
  assert.equal(await price(), 300, 'not live before approval');

  const list = (await owner.get('/api/admin/approvals')).data;
  assert.equal(list.owner, true);
  const item = list.items.find((a) => a.id === asked.data.id);
  assert.match(item.summary, /Test Brass: ₹300 → ₹340/);
  assert.ok((await owner.get('/api/admin/todo')).data.some((t) => t.key === 'approvals'), 'on the owner\'s to-do list');
  assert.ok(!(await mgr.get('/api/admin/todo')).data.some((t) => t.key === 'approvals'), 'not on the manager\'s');
  assert.equal((await mgr.post(`/api/admin/approvals/${item.id}/approve`)).status, 403, 'managers cannot approve');

  const approved = await owner.post(`/api/admin/approvals/${item.id}/approve`, { note: 'OK' });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, 'approved');
  assert.equal(await price(), 340, 'live after approval');
  assert.equal((await owner.post(`/api/admin/approvals/${item.id}/approve`)).status, 409, 'decided only once');

  // A new staff login: the password is stored only as a hash, and works after approval.
  const staff = await mgr.post('/api/admin/staff', { name: 'Test Waiting Staff', username: 'testwaiting', password: 'wait-pass-1' });
  assert.equal(staff.status, 202);
  const { rows: [held] } = await pool.query('SELECT body FROM pending_changes WHERE id = $1', [staff.data.id]);
  assert.equal(held.body.password, undefined, 'no plain password is kept');
  assert.match(held.body.passwordHash, /^\$2/);
  assert.equal((await staffLogin('testwaiting', 'wait-pass-1')).status, 401, 'cannot log in before approval');
  assert.equal((await owner.post(`/api/admin/approvals/${staff.data.id}/approve`)).data.status, 'approved');
  assert.ok((await staffLogin('testwaiting', 'wait-pass-1')).get, 'can log in after approval');

  // Rejected: never applied.
  const before = (await owner.get('/api/admin/board/yard')).data;
  const yard = await mgr.put('/api/admin/board/yard', { address: 'Test fake yard address, Somewhere', hours: '', map: '', pocName: '', pocPhone: '' });
  assert.equal(yard.status, 202);
  assert.equal((await owner.post(`/api/admin/approvals/${yard.data.id}/reject`, { note: 'Wrong address' })).data.status, 'rejected');
  assert.deepEqual((await owner.get('/api/admin/board/yard')).data, before, 'the yard address did not change');

  // The manager sees only their own requests, with the outcome.
  const mine = (await mgr.get('/api/admin/approvals')).data;
  assert.equal(mine.owner, false);
  assert.ok(mine.items.some((a) => a.id === yard.data.id && a.status === 'rejected' && a.decision_note === 'Wrong address'));

  await new Promise((r) => setTimeout(r, 300));
  const log = (await owner.get('/api/admin/activity')).data.map((a) => a.action);
  assert.ok(log.some((a) => a.startsWith('Asked the owner to approve')), 'the request is in the activity log');
  assert.ok(log.some((a) => a.startsWith("Approved a manager's change")));
});
