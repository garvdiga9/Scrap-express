// The site's public address, from SITE_URL (set on Render). Everything that
// writes a full link uses this: canonical tags, sitemap.xml, robots.txt,
// structured data, emails, quote links and notifications. To move to a custom
// domain, change SITE_URL on Render and redeploy; nothing else in the code
// needs to change.
const DEFAULT_URL = 'https://scrap-express.onrender.com';

const SITE_URL = (process.env.SITE_URL || DEFAULT_URL).trim().replace(/\/+$/, '');
const SITE_HOST = new URL(SITE_URL).host;

// After a move to a custom domain, page visits to any other address of this
// server (e.g. the old *.onrender.com one) are sent to the same page on the
// new domain with a permanent redirect, so search engines move their listings
// across. The API, app links and local development are left alone.
// Set REDIRECT_TO_SITE_URL=false to turn this off.
const SKIP_PATHS = /^\/(api|\.well-known)\//;
function redirectToSiteUrl(req, res, next) {
  if (process.env.REDIRECT_TO_SITE_URL === 'false') return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const host = req.get('host') || '';
  if (!host || host === SITE_HOST || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || SKIP_PATHS.test(req.path)) return next();
  // Only redirect our own Render address, not arbitrary Host headers.
  if (!/\.onrender\.com$/.test(host.split(':')[0])) return next();
  return res.redirect(301, `${SITE_URL}${req.originalUrl}`);
}

module.exports = { SITE_URL, SITE_HOST, redirectToSiteUrl };
