// Public pages, Hindi, and the booking form's checks.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE, client, pool, cleanUp,
} = require('./helpers');
const { MIN_PICKUP_KG, PICKUP_FREQUENCIES } = require('../data/business');

after(async () => { await cleanUp(); await pool.end(); });

const PAGES = ['/', '/rates', '/what-we-buy', '/book-pickup', '/demolition', '/areas', '/buy-from-us', '/rules', '/privacy', '/delete-account', '/login'];

test('every public page opens, in English and Hindi', async () => {
  for (const p of PAGES) {
    const en = await fetch(BASE + p);
    assert.equal(en.status, 200, p);
    const hi = await (await fetch(`${BASE}${p}?lang=hi`)).text();
    assert.ok(hi.includes('lang="hi-IN"'), `${p} in Hindi`);
  }
  assert.equal((await fetch(`${BASE}/no-such-page`)).status, 404);
  assert.equal((await fetch(`${BASE}/admin.html`)).status, 200);
  assert.equal((await fetch(`${BASE}/staff.html`)).status, 200);
});

test('Hindi pages have no English sentences left', async () => {
  // Brand, contact details, units and dates may stay in English.
  const OK = /^(Scrap|Express|Scrap Express|scrapexpress@gmail\.com|WhatsApp|GSTIN|OpenStreetMap|&copy;|&times;|हिंदी|English|kg|\/kg|CPU|UPS|AC PCB|GST|you@company\.com|you@example\.com|98765 43210|\+91 98188 26333|07ABCDE1234F1Z5|Shri Ram Honda|Kirloskar|Sudhir|Mahindra)$/;
  const left = [];
  for (const p of ['/', '/rates', '/what-we-buy', '/book-pickup', '/demolition', '/areas', '/buy-from-us', '/rules', '/privacy']) {
    let html = await (await fetch(`${BASE}${p}?lang=hi`)).text();
    html = html.replace(/<(script|style|textarea)\b[\s\S]*?<\/\1>/gi, '');
    for (const m of html.matchAll(/>([^<>]+)</g)) {
      const s = m[1].replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{3}/.test(s) || /[ऀ-ॿ]/.test(s) || OK.test(s)) continue;
      if (/^\d{1,2} [A-Z][a-z]{2} \d{4}/.test(s)) continue; // a date
      if (/^[a-z0-9.-]+\.(com|in|app)$/.test(s)) continue; // a web address
      left.push(`${p}: ${s}`);
    }
  }
  assert.deepEqual(left, []);
});

test('the rates page explains what decides the final rate', async () => {
  const html = await (await fetch(`${BASE}/rates`)).text();
  assert.ok(html.includes('What decides your final rate'));
  assert.ok(html.includes('split AC fixed high on a wall'));
});

test('admin and staff data need a sign-in', async () => {
  const anon = client();
  for (const url of ['/api/admin/requests', '/api/admin/todo', '/api/admin/team', '/api/admin/activity', '/api/admin/staff']) {
    assert.equal((await anon.get(url)).status, 401, url);
  }
  assert.equal((await anon.get('/api/staff/pickups')).status, 401);
  assert.equal((await anon.get('/api/customer/me')).status, 401);
});

test(`booking: minimum ${MIN_PICKUP_KG} kg, real phone numbers, known places`, async () => {
  const anon = client();
  const step1 = {
    companyName: 'Test Booking Co', phone: '9811122233', scrapTypes: ['Paper & Cardboard'], quantity: String(MIN_PICKUP_KG + 10), quantityUnit: 'kg',
  };
  assert.equal((await anon.post('/api/pickup/lead', { ...step1, quantity: String(MIN_PICKUP_KG - 10) })).status, 400);
  assert.equal((await anon.post('/api/pickup/lead', { ...step1, phone: '12' })).status, 400);
  const lead = await anon.post('/api/pickup/lead', step1);
  assert.equal(lead.status, 201);
  assert.ok(lead.data.leadToken);

  const full = {
    ...step1, leadToken: lead.data.leadToken, name: 'Test Person', businessType: 'Warehouse', pickupFrequency: PICKUP_FREQUENCIES[0],
    building: 'Plot 1', street: 'Okhla Phase 2', pincode: '110020', city: 'South Delhi', state: 'Delhi', area: 'Okhla Industrial Area', acceptTerms: 'on',
  };
  assert.equal((await anon.post('/api/pickup', { ...full, acceptTerms: '' })).status, 400, 'rules must be accepted');
  assert.equal((await anon.post('/api/pickup', { ...full, scrapLocation: 'On the moon' })).status, 400);
  const pickup = await anon.post('/api/pickup', { ...full, scrapLocation: 'Upper floor, stairs only', needsDismantling: 'yes' });
  assert.equal(pickup.status, 201, pickup.data.error);
  const { rows: [p] } = await pool.query('SELECT delivery_mode, office_handled, scrap_location, needs_dismantling FROM pickup_requests WHERE id = $1', [pickup.data.id]);
  assert.deepEqual(p, {
    delivery_mode: 'pickup', office_handled: false, scrap_location: 'Upper floor, stairs only', needs_dismantling: true,
  });
  const lead2 = await pool.query('SELECT completed_at IS NOT NULL AS done FROM pickup_leads WHERE token = $1', [lead.data.leadToken]);
  assert.equal(lead2.rows[0].done, true, 'step 1 lead is closed by step 2');

  const drop = await anon.post('/api/pickup', { ...full, leadToken: '', deliveryMode: 'self', scrapLocation: 'Basement', needsDismantling: 'yes' });
  assert.equal(drop.status, 201);
  const { rows: [d] } = await pool.query('SELECT delivery_mode, office_handled, scrap_location, needs_dismantling FROM pickup_requests WHERE id = $1', [drop.data.id]);
  assert.deepEqual(d, {
    delivery_mode: 'self', office_handled: true, scrap_location: null, needs_dismantling: false,
  });
});
