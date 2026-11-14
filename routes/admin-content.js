// Admin: site photos and client logos (home page), lots for sale to
// recyclers ("Buy from us") and the enquiries about them. Mounted at
// /api/admin; every route needs the admin login.
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAdmin, requireOwner } = require('../middleware/auth');
const team = require('../lib/team');
const activity = require('../lib/activity');
const siteImages = require('../lib/site-images');
const lots = require('../lib/lots');
const live = require('../lib/live');
const analytics = require('../lib/analytics');
const dispatch = require('../lib/dispatch');
const cash = require('../lib/cash');
const notify = require('../lib/notify');
const board = require('../lib/board');
const ratings = require('../lib/ratings');
const { cleanPhone } = require('../lib/validation');
const documents = require('../lib/documents');
const push = require('../lib/push');

router.use(requireAdmin);

const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// ---- staff accounts ----

router.get('/staff', async (req, res) => {
  try {
    res.json(await dispatch.listStaff());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff' });
  }
});

const saveStaff = (getId) => async (req, res) => {
  try {
    const { staff, error } = await dispatch.saveStaff(getId(req), req.body || {}, { cleanPhone });
    if (error) return res.status(400).json({ error });
    res.status(getId(req) ? 200 : 201).json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the staff member.' });
  }
};
// Staff logins are set by the owner; managers see the list (to assign pickups).
router.post('/staff', requireOwner, saveStaff(() => null));
router.put('/staff/:id', requireOwner, saveStaff((req) => Number(req.params.id)));

// ---- team: dashboard logins and the activity log (owner only) ----

router.get('/team', requireOwner, async (req, res) => {
  try {
    res.json(await team.list());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the team' });
  }
});

const saveTeam = (getId) => async (req, res) => {
  const id = getId(req);
  if (id !== null && !Number.isInteger(id)) return res.status(400).json({ error: 'Unknown login.' });
  try {
    const { user, error } = await team.save(id, req.body || {});
    if (error) return res.status(400).json({ error });
    res.status(id ? 200 : 201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the login.' });
  }
};
router.post('/team', requireOwner, saveTeam(() => null));
router.put('/team/:id', requireOwner, saveTeam((req) => Number(req.params.id)));

router.delete('/team/:id', requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Unknown login.' });
  try {
    const { error } = await team.remove(id);
    if (error) return res.status(400).json({ error });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the login.' });
  }
});

// GET /activity?adminId=&area=
router.get('/activity', requireOwner, async (req, res) => {
  try {
    const adminId = Number(req.query.adminId) || null;
    const area = /^[a-z-]{1,40}$/.test(req.query.area || '') ? req.query.area : null;
    res.json(await activity.recent({ adminId, area }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the activity log' });
  }
});

router.delete('/staff/:id', async (req, res) => {
  try {
    await dispatch.removeStaff(Number(req.params.id));
    res.json({ message: 'Deleted' });
    live.publish('requests');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the staff member.' });
  }
});

// ---- customers' ratings ----

router.get('/ratings', async (req, res) => {
  try {
    res.json(await ratings.recent());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
});

router.post('/ratings/:id/publish', async (req, res) => {
  try {
    const result = await ratings.publish(Number(req.params.id));
    if (result.error) return res.status(409).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not publish it.' });
  }
});

// ---- dispatch board ----

router.get('/board', async (req, res) => {
  const days = [3, 7, 14].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  try {
    res.json(await board.board(days));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the board' });
  }
});

router.put('/board/settings', async (req, res) => {
  try {
    const { settings, error } = await board.saveSettings(req.body || {});
    if (error) return res.status(400).json({ error });
    res.json(settings);
    live.publish('requests');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save.' });
  }
});

// POST /slots/check { slots: [{ date, from, to }] } -> how busy each one is
router.post('/slots/check', async (req, res) => {
  const slots = (Array.isArray(req.body.slots) ? req.body.slots : []).slice(0, 4)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^\d{2}:\d{2}$/.test(s.from) && /^\d{2}:\d{2}$/.test(s.to) && s.from < s.to);
  try {
    res.json(await board.check(slots));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not check the slots.' });
  }
});

// ---- the message for a customer's current step, to send by hand ----

// GET /requests/:id/update-text -> { text, channels }
router.get('/requests/:id/update-text', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS staff_name, s.slot_date, s.time_from, s.time_to
       FROM pickup_requests p LEFT JOIN staff_users u ON u.id = p.staff_id LEFT JOIN pickup_slots s ON s.id = p.slot_id
       WHERE p.id = $1`, [Number(req.params.id)]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Not found' });
    const kind = r.status === 'completed' && r.payment_method === 'bank' && r.bank_paid_at ? 'bank_paid' : r.status;
    const extra = {
      slotText: r.slot_date ? dispatch.slotLabel(r) : '',
      deadlineText: r.slots_deadline ? new Date(r.slots_deadline).toLocaleString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
      }) : '',
    };
    res.json({ text: notify.manualText(kind, { ...r, ...extra }), channels: notify.channels() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not prepare the message.' });
  }
});

// ---- money: cash with staff, bank transfers to make ----

router.get('/cash', async (req, res) => {
  try {
    const [staff, settled, bank, totals] = await Promise.all([cash.staffSummary(), cash.settlements(), cash.bankPayments(), cash.totals()]);
    res.json({
      staff, settled, bank, totals,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the money check' });
  }
});

router.post('/cash/give', async (req, res) => {
  try {
    const { entry, error } = await cash.giveCash(Number(req.body.staffId), req.body.amount, req.body.note, req.session.username);
    if (error) return res.status(400).json({ error });
    res.status(201).json(entry);
    live.publish('requests');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that.' });
  }
});

router.post('/cash/settle', async (req, res) => {
  try {
    const { entry, error } = await cash.settle(Number(req.body.staffId), req.body.returned, req.body.note, req.session.username);
    if (error) return res.status(400).json({ error });
    res.status(201).json(entry);
    live.publish('requests');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that.' });
  }
});

router.post('/requests/:id/bank-paid', async (req, res) => {
  try {
    const { request, error } = await cash.markTransferred(Number(req.params.id), req.body.reference);
    if (error) return res.status(409).json({ error });
    res.json({ ok: true });
    dispatch.requestChanged(request);
    notify.quietly('bank_paid', request.id);
    push.quietly(push.notifyCustomer(request.customer_id, {
      title: 'Payment sent 💸',
      body: `₹${Number(request.amount_paid).toLocaleString('en-IN')} for pickup #${request.id} has been transferred to your bank.`,
      url: '/account',
      tag: `pickup-${request.id}`,
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that.' });
  }
});

// ---- pickup slots and who does the pickup ----

// POST /requests/:id/slots { slots: [{ date, from, to }], deadlineHours }
router.post('/requests/:id/slots', async (req, res) => {
  const { slots, hours, error } = dispatch.parseSlots(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const result = await dispatch.offerSlots(Number(req.params.id), slots, hours);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ slots: result.slots, deadline: result.request.slots_deadline });
    dispatch.announceSlots(result.request, result.slots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send the slots.' });
  }
});

// PUT /requests/:id/staff { staffId | null }
router.put('/requests/:id/staff', async (req, res) => {
  const staffId = req.body.staffId ? Number(req.body.staffId) : null;
  try {
    const row = await dispatch.assign(Number(req.params.id), staffId);
    if (!row) return res.status(409).json({ error: 'This pickup can only be assigned after a slot is chosen and before it is weighed.' });
    res.json({ ok: true });
    dispatch.requestChanged(row);
    if (staffId) {
      push.quietly(push.notifyStaff({
        title: 'A pickup was assigned to you 🚚',
        body: [dispatch.slotLabel(row), row.company_name, row.area].filter(Boolean).join(' · '),
        url: '/staff.html',
        tag: `staff-pickup-${row.id}`,
      }, { onlyId: staffId }));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not assign the pickup.' });
  }
});

// ---- the office runs a pickup itself (outside truck) ----

const MOVED_ON = 'This pickup has changed meanwhile. Please refresh.';

// PUT /requests/:id/outside { provider, driver, phone, vehicle, fare }
router.put('/requests/:id/outside', async (req, res) => {
  try {
    const row = await dispatch.useOutsideTruck(Number(req.params.id), req.body || {});
    if (!row) return res.status(409).json({ error: 'An outside truck can be set once a slot is chosen, and before the scrap is weighed.' });
    if (row.error) return res.status(400).json({ error: row.error });
    res.json({ ok: true });
    dispatch.requestChanged(row);
    // The staff member who had it is told it's off their list.
    if (row.previous_staff_id) {
      push.quietly(push.notifyStaff({
        title: `Pickup #${row.id} is off your list`,
        body: 'The office is sending another truck for it.',
        url: '/staff.html',
        tag: `staff-pickup-${row.id}`,
      }, { onlyId: row.previous_staff_id }));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the truck details.' });
  }
});

// POST /requests/:id/book-slot { slotId }: choose one of the offered times for the customer.
router.post('/requests/:id/book-slot', async (req, res) => {
  const slotId = Number(req.body.slotId);
  if (!Number.isInteger(slotId)) return res.status(400).json({ error: 'Please choose a time.' });
  try {
    const row = await dispatch.bookForCustomer(Number(req.params.id), slotId);
    if (!row) return res.status(409).json({ error: 'A time can be booked while slots are offered, or to move a booked pickup before it starts.' });
    res.json({ ok: true });
    dispatch.announceBooked(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not book that time.' });
  }
});

// The office's own steps, for a pickup it runs with an outside truck
// (staffId null in lib/dispatch.js means "the office").
const officeStep = (run) => async (req, res) => {
  try {
    const row = await run(req, Number(req.params.id));
    if (!row) return res.status(409).json({ error: MOVED_ON });
    if (row.error) return res.status(400).json({ error: row.error });
    res.json({ ok: true, status: row.status });
    dispatch.announceStep(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
};

// { step: 'on_way' | 'arrived' }
router.post('/requests/:id/office/step', officeStep((req, id) => dispatch.step(null, id, req.body.step)));
router.post('/requests/:id/office/no-scrap', officeStep((req, id) => dispatch.noScrap(null, id)));
// { method: 'cash' | 'bank', amount, note }
router.post('/requests/:id/office/paid', officeStep((req, id) => dispatch.paid(null, id, req.body.method, req.body.amount, req.body.note)));

// The weights (quantities as JSON), with the weighing photo if the driver sent one.
router.post('/requests/:id/office/weigh', (req, res, next) => (req.is('multipart/form-data') ? documents.acceptDocument(req, res, next) : next()), async (req, res) => {
  const doc = req.document || null;
  const fail = async (status, error) => {
    if (doc) await documents.removeFiles([doc.fileName]);
    res.status(status).json({ error });
  };
  let quantities = req.body.quantities;
  if (typeof quantities === 'string') {
    try { quantities = JSON.parse(quantities); } catch (err) { quantities = null; }
  }
  if (doc && !doc.mime.startsWith('image/')) return fail(400, 'The weighing photo must be an image.');
  if (!Array.isArray(quantities)) return fail(400, 'Please enter a weight for each material.');
  try {
    const row = await dispatch.weigh(null, Number(req.params.id), quantities, doc);
    if (!row) return fail(409, MOVED_ON);
    if (row.error) return fail(400, row.error);
    res.json({ ok: true, status: row.status });
    dispatch.announceStep(row);
  } catch (err) {
    console.error(err);
    await fail(500, 'Could not save the weight. Please try again.');
  }
});

// ---- analytics ----

router.get('/analytics', async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  try {
    res.json(await analytics.summary(days));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// ---- photos and logos ----

router.get('/images', async (req, res) => {
  const kind = siteImages.KINDS.includes(req.query.kind) ? req.query.kind : 'gallery';
  try {
    res.json(await siteImages.list(kind));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load photos' });
  }
});

router.post('/images', siteImages.acceptImage, async (req, res) => {
  const fail = async (status, error) => {
    await siteImages.removeFiles([req.image.fileName]);
    res.status(status).json({ error });
  };
  const kind = req.body.kind;
  const fields = { kind, image: req.image, caption: text(req.body.caption, 200) };
  try {
    if (kind === 'gallery') {
      fields.category = req.body.category;
      fields.altText = text(req.body.altText, 200);
      if (!siteImages.GALLERY_CATEGORIES.some((c) => c.key === fields.category)) return fail(400, 'Please choose what the photo shows.');
      if (fields.altText.length < 5) return fail(400, 'Please describe the photo in a few words (for people who can\'t see it, and for search engines).');
    } else if (kind === 'logo') {
      fields.companyName = text(req.body.companyName, 150);
      if (!fields.companyName) return fail(400, 'Please enter the company name.');
      if (req.body.permission !== 'true') return fail(400, 'Only add a logo once the company has given permission to show it.');
      fields.permissionConfirmed = true;
      fields.altText = `${fields.companyName} logo`;
    } else if (kind === 'lot') {
      const lot = await lots.getLot(Number(req.body.lotId));
      if (!lot) return fail(400, 'That lot no longer exists.');
      fields.lotId = lot.id;
      fields.altText = text(req.body.altText, 200) || `${lot.title}, ${lot.material}`;
    } else {
      return fail(400, 'Unknown kind of photo.');
    }
    const image = await siteImages.add(fields);
    res.status(201).json(image);
    live.publish(kind === 'lot' ? 'lots' : 'reviews'); // the home page refreshes with its reviews
  } catch (err) {
    console.error(err);
    await fail(500, 'Could not save the photo.');
  }
});

router.delete('/images/:id', async (req, res) => {
  try {
    await siteImages.remove(Number(req.params.id));
    res.json({ message: 'Deleted' });
    live.publish('reviews');
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the photo.' });
  }
});

// ---- papers on a request: weighbridge slips, GST invoices ----

router.get('/documents', async (req, res) => {
  if (!['pickup', 'demolition'].includes(req.query.requestType)) return res.status(400).json({ error: 'Bad request' });
  try {
    res.json(await documents.listFor(req.query.requestType, [Number(req.query.requestId)]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.post('/documents', documents.acceptDocument, async (req, res) => {
  const { requestType, kind } = req.body;
  const requestId = Number(req.body.requestId);
  const fail = async (status, error) => {
    await documents.removeFiles([req.document.fileName]);
    res.status(status).json({ error });
  };
  if (!['pickup', 'demolition'].includes(requestType) || !documents.KINDS[kind]) {
    return fail(400, 'Please choose what kind of document it is.');
  }
  try {
    const sql = requestType === 'pickup'
      ? 'SELECT id, customer_id, quote_token FROM pickup_requests WHERE id = $1'
      : 'SELECT id, customer_id, NULL AS quote_token FROM demolition_requests WHERE id = $1';
    const { rows } = await pool.query(sql, [requestId]);
    if (!rows[0]) return fail(404, 'That request no longer exists.');
    const doc = await documents.add(requestType, requestId, kind, req.document);
    res.status(201).json(doc);
    live.requestChanged(rows[0].customer_id, rows[0].quote_token);
    live.publish('requests');
    if (rows[0].customer_id) {
      push.quietly(push.notifyCustomer(rows[0].customer_id, {
        title: `${documents.KINDS[kind]} ready 📄`,
        body: `Your ${documents.KINDS[kind].toLowerCase()} for request #${requestId} is in My Account.`,
        url: '/account',
        tag: `doc-${doc.id}`,
      }));
    }
  } catch (err) {
    console.error(err);
    await fail(500, 'Could not save the document.');
  }
});

router.get('/documents/:id/file', async (req, res) => {
  const doc = await documents.find(Number(req.params.id)).catch(() => null);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  documents.send(res, doc, { inline: req.query.view === '1' });
});

router.delete('/documents/:id', async (req, res) => {
  try {
    const doc = await documents.remove(Number(req.params.id));
    res.json({ message: 'Deleted' });
    if (doc) live.publish('requests');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the document.' });
  }
});

// ---- lots for sale ----

router.get('/lots', async (req, res) => {
  try {
    res.json(await lots.listLots({ includeSold: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load lots' });
  }
});

router.post('/lots', async (req, res) => {
  const { lot, error } = lots.parseLot(req.body);
  if (error) return res.status(400).json({ error });
  try {
    res.status(201).json(await lots.createLot(lot));
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the lot.' });
  }
});

router.put('/lots/:id', async (req, res) => {
  const { lot, error } = lots.parseLot(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const saved = await lots.updateLot(Number(req.params.id), lot);
    if (!saved) return res.status(404).json({ error: 'Not found' });
    res.json(saved);
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the lot.' });
  }
});

router.delete('/lots/:id', async (req, res) => {
  try {
    await lots.deleteLot(Number(req.params.id));
    res.json({ message: 'Deleted' });
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the lot.' });
  }
});

// ---- enquiries about lots ----

const ENQUIRY_STATUSES = ['new', 'contacted', 'closed'];

router.get('/lot-enquiries', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM lot_enquiries ORDER BY created_at DESC LIMIT 300');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load enquiries' });
  }
});

router.patch('/lot-enquiries/:id', async (req, res) => {
  if (!ENQUIRY_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query('UPDATE lot_enquiries SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.delete('/lot-enquiries/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM lot_enquiries WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
    live.publish('lots');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
