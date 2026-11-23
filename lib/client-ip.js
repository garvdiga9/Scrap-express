// Some hosts' front ends (Azure App Service among them) pass the visitor's
// address with a port on the end ("203.0.113.5:51234"). Express then can't
// read it as an IP, and the per-visitor limits (logins, uploads, floods)
// would treat everyone the same. This strips the port before anything reads
// req.ip. It changes nothing on hosts that send plain addresses (Render).

function stripPort(entry) {
  const value = entry.trim();
  const bracketed = value.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/); // [IPv6]:port
  if (bracketed) return bracketed[1];
  const v4 = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/); // IPv4:port
  if (v4) return v4[1];
  return value;
}

function normaliseForwardedFor(header) {
  return header.split(',').map(stripPort).filter(Boolean).join(', ');
}

function clientIp(req, res, next) {
  const header = req.headers['x-forwarded-for'];
  if (typeof header === 'string' && header) req.headers['x-forwarded-for'] = normaliseForwardedFor(header);
  next();
}

module.exports = { clientIp, normaliseForwardedFor };
