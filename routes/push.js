// Turning notifications on/off for a device. Mounted twice: under
// /api/customer (for the logged-in customer) and /api/admin (for the admin),
// each router having already checked who is signed in.
const push = require('../lib/push');

function mountPushRoutes(router, requireRole, roleOf) {
  // POST /push { subscription } — turn notifications on for this device
  router.post('/push', requireRole, async (req, res) => {
    const sub = push.cleanSubscription(req.body.subscription);
    if (!sub) return res.status(400).json({ error: 'This browser sent an invalid notification subscription.' });
    try {
      await push.subscribe(sub, roleOf(req));
      res.json({ on: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not turn on notifications. Please try again.' });
    }
  });

  // POST /push/status { endpoint } — is this device subscribed?
  router.post('/push/status', requireRole, async (req, res) => {
    try {
      res.json({ on: await push.isSubscribed(String(req.body.endpoint || ''), roleOf(req)) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not check notifications.' });
    }
  });

  // DELETE /push { endpoint } — turn notifications off for this device
  router.delete('/push', requireRole, async (req, res) => {
    try {
      await push.unsubscribe(String(req.body.endpoint || ''), roleOf(req));
      res.json({ on: false });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not turn off notifications. Please try again.' });
    }
  });
}

module.exports = { mountPushRoutes };
