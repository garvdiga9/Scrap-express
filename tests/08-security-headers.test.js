// Security headers (lib/security-headers.js).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { BASE, pool, cleanUp } = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

test('every page sends the security headers', async () => {
  for (const url of ['/', '/book-pickup', '/login', '/admin.html', '/staff.html', '/api/rates']) {
    const res = await fetch(BASE + url);
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/, url);
    assert.match(csp, /frame-ancestors 'self'/, url);
    assert.match(csp, /object-src 'none'/, url);
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.match(res.headers.get('permissions-policy') || '', /geolocation=\(self\)/, url);
  }
});

test('Google sign-in, fonts and analytics are allowed; nothing else from outside', async () => {
  const csp = (await fetch(`${BASE}/login`)).headers.get('content-security-policy');
  for (const host of ['https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://identitytoolkit.googleapis.com', 'https://*.firebaseapp.com']) {
    assert.ok(csp.includes(host), host);
  }
  assert.ok(!/script-src[^;]*\shttps:(\s|;)/.test(csp), 'scripts are not allowed from any https site');
});

test('blocked items reported by browsers are accepted', async () => {
  const res = await fetch(`${BASE}/api/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example', 'document-uri': `${BASE}/` } }),
  });
  assert.equal(res.status, 204);
});
