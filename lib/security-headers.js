// Security headers on every response. They tell browsers:
//  - which outside sites the pages may load code, styles, fonts and frames
//    from (Content-Security-Policy), so injected code from anywhere else
//    won't run
//  - not to show the site inside another site's frame (stops click-jacking)
//  - to always use HTTPS, and not to guess file types
// Outside services allowed: Google Fonts, Firebase / Google sign-in (and
// reCAPTCHA for phone sign-in) and Google Analytics. A new outside service
// must be added below, or the browser will block it (see the
// "Content-Security-Policy" errors in the browser console).
// Browsers report anything blocked to /api/csp-report, which is logged.
const firebaseDomain = (process.env.FIREBASE_AUTH_DOMAIN || '').trim();

const GOOGLE_SIGN_IN = ['https://apis.google.com', 'https://accounts.google.com', 'https://www.google.com', 'https://www.recaptcha.net'];
const FIREBASE_API = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com'];
const ANALYTICS = ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'];

function policy({ production }) {
  const frames = [...(firebaseDomain ? [`https://${firebaseDomain}`] : []), 'https://*.firebaseapp.com', ...GOOGLE_SIGN_IN];
  const rules = {
    'default-src': ["'self'"],
    // Inline scripts: the theme and language snippets in each page's head.
    'script-src': ["'self'", "'unsafe-inline'", 'https://www.gstatic.com', ...GOOGLE_SIGN_IN, 'https://www.googletagmanager.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // Photos: our own, previews of chosen files, Google profile pictures.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:'],
    // Fonts too: the service worker (sw.js) fetches and keeps them for offline use.
    'connect-src': ["'self'", ...FIREBASE_API, ...ANALYTICS, 'https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    'frame-src': frames,
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
    'report-uri': ['/api/csp-report'],
  };
  if (production) rules['upgrade-insecure-requests'] = [];
  return Object.entries(rules).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');
}

function securityHeaders({ production = false } = {}) {
  const csp = policy({ production });
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // Location for "Use my current location"; camera for photos is chosen
      // through the file picker, which needs no permission.
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

// What a browser blocked (logged, so a broken page can be traced).
const recent = new Map();
function cspReport(req, res) {
  const r = (req.body && (req.body['csp-report'] || req.body)) || {};
  const key = `${r['violated-directive'] || r.effectiveDirective}|${r['blocked-uri'] || r.blockedURL}`;
  // At most one log line per blocked thing per hour.
  if (!recent.has(key) || Date.now() - recent.get(key) > 3600e3) {
    recent.set(key, Date.now());
    if (recent.size > 500) recent.clear();
    console.warn(`CSP blocked: ${key} on ${r['document-uri'] || r.documentURL || '?'}`);
  }
  res.status(204).end();
}

module.exports = { securityHeaders, cspReport, policy };
