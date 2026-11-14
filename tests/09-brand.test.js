// Renaming: with BRAND_* set, no trace of the current name, phone or email
// is left in what the site sends. Starts a second copy of the site, renamed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { pool, makeRequest, cleanUp } = require('./helpers');

const PORT = 3998;
const B = `http://localhost:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BRAND_NAME: 'Test Kaanta Co', BRAND_SHORT: 'TK', BRAND_PHONE: '+91 98765 43210', BRAND_EMAIL: 'hello@example.com',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${B}/`)).ok) return; } catch (err) { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('renamed copy did not start');
});
after(async () => {
  if (server) server.kill();
  await cleanUp();
  await pool.end();
});

const OLD = [/Scrap Express/, /Scrap <strong>Express/, /98188/, /9818826333/, /scrapexpress@gmail/, /SE (Admin|Staff)/];

test('pages, Hindi pages, app files and API messages all use the new details', async () => {
  const r = await makeRequest();
  const urls = ['/', '/rates', '/book-pickup', '/rules?lang=hi', '/privacy', '/buy-from-us', `/quote/${r.token}`, `/quote/${r.token}/receipt`,
    '/admin.html', '/staff.html', '/offline.html', '/manifest.webmanifest', '/admin.webmanifest', '/staff.webmanifest', '/js/i18n-hi.js', '/sitemap.xml'];
  for (const url of urls) {
    const res = await fetch(B + url);
    const text = await res.text();
    if (res.status !== 200) continue; // e.g. no receipt for an unweighed request
    for (const old of OLD) assert.doesNotMatch(text, old, `${url} still has ${old}`);
  }
  const home = await (await fetch(`${B}/`)).text();
  assert.match(home, /Test Kaanta <strong>Co<\/strong>/, 'logo');
  assert.match(home, /\+91 98765 43210/);
  assert.match(home, /tel:\+919876543210/);
  assert.match(await (await fetch(`${B}/admin.webmanifest`)).text(), /TK Admin/);
  const security = (await fetch(`${B}/admin.html`)).headers.get('content-security-policy');
  assert.ok(security, 'renamed files keep the security headers');
});

test('the real site is unchanged when nothing is set', async () => {
  const html = await (await fetch(`${process.env.TEST_BASE_URL || 'http://localhost:3000'}/`)).text();
  assert.match(html, /Scrap <strong>Express<\/strong>/);
});
