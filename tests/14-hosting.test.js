// Hosting differences: visitor addresses with a port (Azure's front end)
// are read as plain addresses, so per-visitor limits keep working.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseForwardedFor } = require('../lib/client-ip');

test('visitor addresses lose the port the host adds', () => {
  assert.equal(normaliseForwardedFor('203.0.113.5:51234'), '203.0.113.5');
  assert.equal(normaliseForwardedFor('203.0.113.5'), '203.0.113.5');
  assert.equal(normaliseForwardedFor('[2001:db8::1]:443'), '2001:db8::1');
  assert.equal(normaliseForwardedFor('2001:db8::1'), '2001:db8::1');
  assert.equal(normaliseForwardedFor('198.51.100.7:1111, 10.0.0.4:2222'), '198.51.100.7, 10.0.0.4');
});
