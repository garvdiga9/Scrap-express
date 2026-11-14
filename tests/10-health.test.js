// Health check and error handling (lib/health.js).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { BASE, pool, cleanUp } = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

test('/healthz says the site and database are up', async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.database, 'ok');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('broken requests get a clear answer, not a raw error page', async () => {
  const res = await fetch(`${BASE}/api/pickup/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /could not be read/);
});
