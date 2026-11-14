// Owner and manager logins, and the activity log.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, adminLogin, client, BASE, cleanUp,
} = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

const managerLogin = async (username, password) => {
  const res = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  await res.text();
  if (!res.ok) return { status: res.status };
  return client(res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid')));
};

test('owner manages managers; managers do daily work but cannot delete or manage logins', async () => {
  const owner = await adminLogin();
  assert.equal((await owner.get('/api/admin/me')).data.role, 'owner');

  const made = await owner.post('/api/admin/team', { name: 'Test Manager', username: 'TestMgr', password: 'mgr-pass-123' });
  assert.equal(made.status, 201);
  assert.equal(made.data.username, 'testmgr');
  assert.equal((await owner.post('/api/admin/team', { name: 'X', username: 'testshort', password: 'abc' })).status, 400);
  assert.equal((await owner.post('/api/admin/team', { name: 'Y', username: 'testmgr', password: 'mgr-pass-123' })).status, 400, 'taken');
  const ownerRow = (await owner.get('/api/admin/team')).data.find((u) => u.role === 'owner');
  assert.equal((await owner.put(`/api/admin/team/${ownerRow.id}`, { name: 'Z', username: ownerRow.username })).status, 400, 'owner login is set on the server');

  const mgr = await managerLogin('testmgr', 'mgr-pass-123');
  const me = (await mgr.get('/api/admin/me')).data;
  assert.equal(me.role, 'manager');
  assert.equal(me.name, 'Test Manager');
  for (const url of ['/api/admin/team', '/api/admin/activity']) assert.equal((await mgr.get(url)).status, 403, url);
  assert.equal((await mgr.del('/api/admin/leads/999999')).status, 403);
  assert.equal((await mgr.post('/api/admin/staff', { name: 'S', username: 'testsss', password: 'pppppppp' })).status, 403);
  assert.equal((await mgr.get('/api/admin/staff')).status, 200);
  assert.equal((await mgr.get('/api/admin/requests')).status, 200);
  assert.equal((await mgr.get('/api/admin/todo')).status, 200);
  const perSlot = (await mgr.get('/api/admin/board')).data.perSlot || 2;
  assert.equal((await mgr.put('/api/admin/board/settings', { perSlot })).status, 200);

  await new Promise((r) => setTimeout(r, 300));
  const log = (await owner.get(`/api/admin/activity?adminId=${made.data.id}`)).data.map((a) => `${a.admin_name}: ${a.action}`);
  assert.ok(log.includes('Test Manager: Signed in'));
  assert.ok(log.includes('Test Manager: Changed trucks per slot'));
  const added = (await owner.get('/api/admin/activity')).data.find((a) => a.action === 'Added team login');
  assert.ok(added && !/pass/i.test(added.detail || ''), 'passwords never logged');

  await owner.put(`/api/admin/team/${made.data.id}`, { name: 'Test Manager', username: 'testmgr', active: false });
  assert.equal((await mgr.get('/api/admin/me')).status, 401, 'switched off: signed out');
  assert.equal((await managerLogin('testmgr', 'mgr-pass-123')).status, 401);
  assert.equal((await owner.del(`/api/admin/team/${made.data.id}`)).status, 200);
  assert.ok((await owner.get('/api/admin/activity')).data.some((a) => a.admin_name === 'Test Manager'), 'history kept');
});
