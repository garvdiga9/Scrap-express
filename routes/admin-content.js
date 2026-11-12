// Admin: site photos and client logos (home page), lots for sale to
// recyclers ("Buy from us") and the enquiries about them. Mounted at
// /api/admin; every route needs the admin login.
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const siteImages = require('../lib/site-images');
const lots = require('../lib/lots');
const live = require('../lib/live');
const analytics = require('../lib/analytics');
const documents = require('../lib/documents');
const push = require('../lib/push');

router.use(requireAdmin);

const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

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
  documents.send(res, doc);
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
