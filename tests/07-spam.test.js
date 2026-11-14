// Spam protection on the public forms (lib/spam.js).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { BASE, pool, cleanUp } = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

const post = async (url, body, headers = {}) => {
  const res = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const count = async (sql) => (await pool.query(sql)).rows[0].n;

test('a filled-in hidden field gets a normal reply, and nothing is saved', async () => {
  const before = {
    leads: await count("SELECT COUNT(*)::int AS n FROM pickup_leads WHERE company_name = 'Test Spam Co'"),
    pickups: await count("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE company_name = 'Test Spam Co'"),
    demolitions: await count('SELECT COUNT(*)::int AS n FROM demolition_requests'),
    subscribers: await count('SELECT COUNT(*)::int AS n FROM subscribers'),
  };
  const bot = { website: 'http://spam.example', companyName: 'Test Spam Co', phone: '9811122233', scrapTypes: ['Paper & Cardboard'], quantity: '500', quantityUnit: 'kg' };

  const lead = await post('/api/pickup/lead', bot);
  assert.equal(lead.status, 201);
  assert.ok(lead.data.leadToken, 'looks like success');
  assert.equal((await post('/api/pickup', { ...bot, name: 'Bot' })).status, 201);
  assert.equal((await post('/api/demolition', { website: 'x', name: 'Bot' })).status, 201);
  assert.equal((await post('/api/subscribe', { website: 'x', contact: 'bot@example.com' })).status, 200);

  assert.equal(await count("SELECT COUNT(*)::int AS n FROM pickup_leads WHERE company_name = 'Test Spam Co'"), before.leads);
  assert.equal(await count("SELECT COUNT(*)::int AS n FROM pickup_requests WHERE company_name = 'Test Spam Co'"), before.pickups);
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM demolition_requests'), before.demolitions);
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM subscribers'), before.subscribers);
});

test('one connection can send the booking form at most 10 times an hour', async () => {
  const on = { 'x-test-rate-limit': 'on' };
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await post('/api/pickup', {}, on)).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400), 'the first ten are checked normally');
  assert.equal(statuses[10], 429, 'the eleventh is refused');
  const res = await post('/api/pickup', {}, on);
  assert.match(res.data.error, /Too many tries/);
});

test('real forms carry the hidden field, kept out of sight', async () => {
  for (const page of ['/book-pickup', '/demolition', '/']) {
    const html = await (await fetch(BASE + page)).text();
    assert.match(html, /class="callback-website" aria-hidden="true">[\s\S]*?name="website" tabindex="-1"/, page);
  }
});
