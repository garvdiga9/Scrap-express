// Answering a quote from its private link, no login needed. Mounted at /api/quote.
const router = require('express').Router();
const quotes = require('../lib/quotes');
const live = require('../lib/live');
const documents = require('../lib/documents');
const dispatch = require('../lib/dispatch');
const ratings = require('../lib/ratings');

// POST /api/quote/:token/quote { response } — accept or decline.
router.post('/:token/quote', async (req, res) => {
  const response = { accept: 'accepted', decline: 'declined' }[req.body.response];
  if (!response) return res.status(400).json({ error: 'Please choose accept or decline.' });
  try {
    const updated = await quotes.respond(req.params.token, response);
    if (!updated) return res.status(409).json({ error: 'This quote can no longer be answered. Please refresh the page.' });
    res.json({ ok: true, status: response });
    live.requestChanged(updated.customer_id, updated.quote_token);
    quotes.notifyAnswer(updated, response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your answer. Please try again.' });
  }
});

// POST /api/quote/:token/ready { readyDate } — "My scrap is ready".
router.post('/:token/ready', async (req, res) => {
  const { readyDate } = req.body;
  if (!quotes.validReadyDate(readyDate)) return res.status(400).json({ error: 'Please choose a date in the next 30 days.' });
  try {
    const updated = await quotes.markReady(req.params.token, readyDate);
    if (!updated) return res.status(409).json({ error: 'This request has already moved on. Please refresh the page.' });
    res.json({ ok: true });
    live.requestChanged(updated.customer_id, updated.quote_token);
    quotes.notifyReady(updated, readyDate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// POST /api/quote/:token/slot { slotId } — pick one of the offered pickup slots.
router.post('/:token/slot', async (req, res) => {
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const row = await dispatch.chooseSlot(request.id, { token: req.params.token }, Number(req.body.slotId));
    if (row.error) return res.status(409).json({ error: row.error });
    res.json({ ok: true });
    dispatch.announceChosen(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// Changing a booked pickup, or cancelling, before our team sets off.
router.post('/:token/reschedule', async (req, res) => {
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const result = req.body.newSlots
      ? await dispatch.askNewSlots(request.id, { token: req.params.token })
      : await dispatch.changeSlot(request.id, { token: req.params.token }, Number(req.body.slotId));
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
    dispatch.announceChange(req.body.newSlots ? 'new_slots' : 'moved', result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

router.post('/:token/cancel', async (req, res) => {
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const result = await dispatch.cancelByCustomer(request.id, { token: req.params.token }, req.body.reason);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
    dispatch.announceChange('cancelled', result, result.cancel_reason);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// Rating a finished pickup.
router.post('/:token/rating', async (req, res) => {
  try {
    const request = await quotes.findByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const result = await ratings.rate(request.id, { token: req.params.token }, req.body || {});
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that. Please try again.' });
  }
});

// GET /api/quote/:token/documents/:id — a weighbridge slip or invoice on
// the request this private link belongs to.
router.get('/:token/documents/:id', async (req, res) => {
  try {
    const request = await quotes.findByToken(req.params.token);
    const doc = request && await documents.find(Number(req.params.id));
    if (!doc || doc.request_type !== 'pickup' || doc.request_id !== request.id) return res.status(404).json({ error: 'Not found' });
    documents.send(res, doc, { inline: req.query.view === '1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not download the file.' });
  }
});

module.exports = router;
