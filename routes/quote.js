// Answering a quote from its private link, no login needed. Mounted at /api/quote.
const router = require('express').Router();
const quotes = require('../lib/quotes');
const live = require('../lib/live');

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

module.exports = router;
