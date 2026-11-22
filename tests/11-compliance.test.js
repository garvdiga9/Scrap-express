// Legal compliance: complaints to the Grievance Officer, the owner's legal
// details on the public pages, the handover code and seller ID at the
// weighing, and a customer's data download.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE, JPEG, pool, adminLogin, staffLogin, customerLogin, makeRequest, client, cleanUp,
} = require('./helpers');

after(async () => { await cleanUp(); await pool.end(); });

const postForm = async (url, fields) => {
  const res = await fetch(BASE + url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, html: await res.text() };
};

test('a complaint: ticket at once, private status check, resolved with a reply', async () => {
  const complaint = {
    name: 'Test Complainer', phone: '9811122266', email: '', requestRef: 'Bulk Pickup #1', category: 'Weighing', message: 'The weight looked wrong.',
  };
  assert.equal((await postForm('/grievance', { ...complaint, phone: '12345' })).status, 400, 'real phone numbers only');
  assert.equal((await postForm('/grievance', { ...complaint, category: 'Nonsense' })).status, 400, 'known categories only');
  const sent = await postForm('/grievance', complaint);
  assert.equal(sent.status, 201);
  const ticket = (sent.html.match(/GRV-\d{5,}/) || [])[0];
  assert.ok(ticket, 'a ticket number is shown straight away');
  const { rows: [g] } = await pool.query('SELECT * FROM grievances WHERE ticket = $1', [ticket]);
  assert.ok(g.acknowledged_at, 'acknowledged automatically');

  assert.equal((await postForm('/grievance/status', { ticket, phone: '9811122299' })).status, 404, 'the phone number must match');
  const status = await postForm('/grievance/status', { ticket: ticket.toLowerCase(), phone: '98111 22266' });
  assert.equal(status.status, 200);
  assert.ok(status.html.includes('Received'));

  assert.equal((await client().get('/api/admin/grievances')).status, 401);
  const admin = await adminLogin();
  assert.ok((await admin.get('/api/admin/todo')).data.some((t) => t.key === 'grievances'), 'open complaints are on the to-do list');
  assert.ok((await admin.get('/api/admin/grievances')).data.some((x) => x.ticket === ticket));
  assert.equal((await admin.patch(`/api/admin/grievances/${g.id}`, { status: 'resolved', response: '' })).status, 400, 'a reply is needed to resolve');
  const done = await admin.patch(`/api/admin/grievances/${g.id}`, { status: 'resolved', response: 'We re-checked the weighbridge slip and paid the difference.' });
  assert.equal(done.status, 200);
  assert.ok(done.data.resolved_at);
  const after = await postForm('/grievance/status', { ticket, phone: '9811122266' });
  assert.ok(after.html.includes('paid the difference'), 'the customer sees the reply');
  await pool.query('DELETE FROM grievances WHERE id = $1', [g.id]);
});

test('legal details: owner only, checked, and shown only when filled in', async () => {
  const { rows: [before] } = await pool.query("SELECT value FROM app_settings WHERE key = 'legal'");
  try {
    assert.equal((await client().get('/api/admin/legal')).status, 401);
    const admin = await adminLogin();
    const blank = { entityName: '', gstin: '', officer: {}, recyclers: [] };
    assert.equal((await admin.put('/api/admin/legal', blank)).status, 200);
    let page = await client().page('/legal');
    assert.ok(!page.includes('Legal name'), 'nothing made up when empty');
    assert.ok(!(await client().page('/')).includes('/recycling-partners"'), 'no partners link without partners');

    assert.equal((await admin.put('/api/admin/legal', { ...blank, gstin: 'ABC' })).status, 400, 'GSTIN format');
    assert.equal((await admin.put('/api/admin/legal', { ...blank, recyclers: [{ name: 'Test Recycler', type: 'E-waste' }] })).status, 400, 'registration number needed');
    const saved = await admin.put('/api/admin/legal', {
      entityName: 'Test Traders', gstin: '07ABCDE1234F1Z5', bankDays: 2,
      officer: { name: 'Test Officer', designation: 'Partner', email: 'officer@example.com', phone: '9811122277' },
      recyclers: [{ name: 'Test Recycler', type: 'E-waste', regNo: 'DPCC/EW/123' }],
    });
    assert.equal(saved.status, 200, saved.data.error);
    assert.ok(saved.data.missing.includes('scale stamping certificate'));
    page = await client().page('/legal');
    assert.ok(page.includes('Test Traders') && page.includes('07ABCDE1234F1Z5'));
    assert.ok((await client().page('/recycling-partners')).includes('DPCC/EW/123'));
    assert.ok((await client().page('/terms')).includes('within 2 working days'));
    assert.ok((await client().page('/grievance')).includes('Test Officer'));
  } finally {
    if (before) await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'legal'", [before.value]);
    else await pool.query("DELETE FROM app_settings WHERE key = 'legal'");
  }
});

async function weigh(staff, id, extra = {}) {
  const form = new FormData();
  form.append('quantities', JSON.stringify([100, 1]));
  Object.entries(extra).forEach(([k, v]) => form.append(k, v));
  form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'weigh.jpg');
  return staff.post(`/api/staff/pickups/${id}/weigh`, form);
}

test('handover code and seller ID at the weighing', async () => {
  const admin = await adminLogin();
  assert.equal((await admin.post('/api/admin/staff', { name: 'Test Verma', username: 'testverma', password: 'test-pass-3' })).status, 201);
  const staff = await staffLogin('testverma', 'test-pass-3');
  const { rows: [s] } = await pool.query("SELECT id FROM staff_users WHERE username = 'testverma'");
  const r = await makeRequest({ company: 'Test Handover Co' });
  const { rows: [slot] } = await pool.query("INSERT INTO pickup_slots (request_id, slot_date, time_from, time_to) VALUES ($1, CURRENT_DATE, '10:00', '13:00') RETURNING id", [r.id]);
  await pool.query("UPDATE pickup_requests SET status = 'arrived', quote_response = 'accepted', staff_id = $1, slot_id = $3 WHERE id = $2", [s.id, r.id, slot.id]);
  const { rows: [{ handover_code: code }] } = await pool.query('SELECT handover_code FROM pickup_requests WHERE id = $1', [r.id]);
  assert.match(code, /^\d{4}$/, 'every pickup gets a code');

  assert.ok((await client().page(`/quote/${r.token}`)).includes(code), 'the customer sees the code');
  const mine = (await staff.get('/api/staff/pickups')).data.mine.find((p) => p.id === r.id);
  assert.equal(mine.needsHandoverCode, true);
  assert.ok(!JSON.stringify(mine).includes(`"${code}"`), 'staff never receive the code');

  const wrong = code === '0000' ? '1111' : '0000';
  assert.equal((await weigh(staff, r.id, { handoverCode: wrong })).status, 400, 'a wrong code is refused');
  assert.equal((await weigh(staff, r.id, { handoverCode: code, sellerIdType: 'Aadhaar', sellerIdLast4: '123456789012' })).status, 400, 'never a full ID number');
  const ok = await weigh(staff, r.id, { handoverCode: code, sellerIdType: 'Aadhaar', sellerIdLast4: '4821' });
  assert.equal(ok.status, 200, ok.data.error);
  const { rows: [p] } = await pool.query('SELECT handover_checked, seller_id_type, seller_id_last4, weigh_warnings FROM pickup_requests WHERE id = $1', [r.id]);
  assert.equal(p.handover_checked, true);
  assert.equal(p.seller_id_type, 'Aadhaar');
  assert.equal(p.seller_id_last4, '4821');

  // Skipping the checks is allowed but flagged for the owner.
  const r2 = await makeRequest({ company: 'Test Handover Co 2' });
  await pool.query("UPDATE pickup_requests SET status = 'arrived', staff_id = $1 WHERE id = $2", [s.id, r2.id]);
  assert.equal((await weigh(staff, r2.id)).status, 200);
  const { rows: [p2] } = await pool.query('SELECT handover_checked, weigh_warnings FROM pickup_requests WHERE id = $1', [r2.id]);
  assert.equal(p2.handover_checked, false);
  assert.ok(JSON.stringify(p2.weigh_warnings).includes('handover code'));
});

test('customers can download their data', async () => {
  assert.equal((await client().get('/api/customer/export')).status, 401);
  const customer = await customerLogin('Test Exporter');
  await makeRequest({ company: 'Test Export Co', customerId: customer.id });
  const res = await customer.get('/api/customer/export');
  assert.equal(res.status, 200);
  assert.equal(res.data.profile.name, 'Test Exporter');
  assert.ok(res.data.pickups.some((x) => x.company_name === 'Test Export Co'));
});

test('UPI payment at the site: transaction ID required, shown on the receipt', async () => {
  const admin = await adminLogin();
  assert.equal((await admin.post('/api/admin/staff', { name: 'Test Upi', username: 'testupi', password: 'test-pass-4' })).status, 201);
  const staff = await staffLogin('testupi', 'test-pass-4');
  const { rows: [s] } = await pool.query("SELECT id FROM staff_users WHERE username = 'testupi'");
  const r = await makeRequest({ company: 'Test UPI Co' });
  await pool.query(
    `UPDATE pickup_requests SET status = 'weighed', quote_response = 'accepted', staff_id = $1, amount_due = 3000, weighed_kg = 100, weighed_at = NOW(),
       weighed_items = $3 WHERE id = $2`,
    [s.id, r.id, JSON.stringify([{
      material: 'Iron', rate: 30, unit: 'per kg', qty: 100, amount: 3000,
    }])]
  );
  const before = (await admin.get('/api/admin/cash')).data;
  assert.equal((await staff.post(`/api/staff/pickups/${r.id}/paid`, { method: 'upi', amount: 3000 })).status, 400, 'transaction ID needed');
  assert.equal((await staff.post(`/api/staff/pickups/${r.id}/paid`, { method: 'upi', amount: 3000, reference: '12' })).status, 400, 'a real transaction ID');
  const paid = await staff.post(`/api/staff/pickups/${r.id}/paid`, { method: 'upi', amount: 3000, reference: '4321 0987 6543' });
  assert.equal(paid.status, 200, paid.data.error);
  const { rows: [p] } = await pool.query('SELECT payment_method, payment_reference FROM pickup_requests WHERE id = $1', [r.id]);
  assert.deepEqual(p, { payment_method: 'upi', payment_reference: '432109876543' });
  assert.ok((await client().page(`/quote/${r.token}/receipt`)).includes('Paid by UPI (ref. 432109876543)'));
  const after = (await admin.get('/api/admin/cash')).data;
  assert.equal(after.totals.upi_today - before.totals.upi_today, 3000);
});
