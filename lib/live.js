// Tells open pages the moment something changes, so nobody has to reload.
// Each page holds one connection (Server-Sent Events) and is only told WHAT
// changed, never the data: it then fetches fresh data through the normal
// routes, which check who is logged in.
// Connections live in this process, which works while the site runs as a
// single server (see render.yaml).
const HEARTBEAT_MS = 25 * 1000;
const MAX_PER_CONNECTION_IP = 30;
const ADMIN_TOPICS = new Set(['requests', 'subscribers', 'callbacks', 'customers']);

const clients = new Set();

function send(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${data}\n\n`);
}

// GET /api/live
function connect(req, res) {
  const fromThisIp = [...clients].filter((c) => c.ip === req.ip).length;
  if (fromThisIp >= MAX_PER_CONNECTION_IP) return res.status(429).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const client = {
    res,
    ip: req.ip,
    isAdmin: Boolean(req.session && req.session.isAdmin),
    customerId: (req.session && req.session.customerId) || null,
    // Only someone holding a quote link can follow that quote.
    quoteToken: typeof req.query.quote === 'string' ? req.query.quote : null,
  };
  clients.add(client);
  req.on('close', () => clients.delete(client));
  send(client, 'ping', 'hello');
}

// Rates and reviews go to everyone; the rest to admins only.
function publish(topic) {
  clients.forEach((client) => {
    if (client.isAdmin || !ADMIN_TOPICS.has(topic)) send(client, 'change', topic);
  });
}

// This customer's own requests or details changed (any of their devices).
function publishToCustomer(customerId) {
  if (!customerId) return;
  clients.forEach((client) => {
    if (client.customerId === customerId) send(client, 'change', 'account');
  });
}

// A pickup or demolition request changed: the admin list, its customer, and
// anyone with its quote link open.
function requestChanged(customerId, quoteToken) {
  publish('requests');
  publishToCustomer(customerId);
  if (!quoteToken) return;
  clients.forEach((client) => {
    if (client.quoteToken === quoteToken) send(client, 'change', 'quote');
  });
}

// A silent connection tells the page it's been cut off, so it reconnects.
setInterval(() => {
  clients.forEach((client) => send(client, 'ping', 'still here'));
}, HEARTBEAT_MS).unref();

module.exports = { connect, publish, publishToCustomer, requestChanged };
