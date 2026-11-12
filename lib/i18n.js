// Hindi / English. Pages are written in English; when a visitor picks Hindi
// (?lang=hi, remembered in a cookie), the finished HTML is translated piece by
// piece from data/i18n/hi.js before it's sent: every bit of visible text, and
// the placeholder / title / aria-label / alt / description attributes. Text
// not in the dictionary stays in English (names, addresses, things customers
// typed). Text that pages add later with JavaScript (messages, errors) is
// translated in the browser from the same dictionary (public/js/i18n.js,
// which uses the same rules as below).
const { HI } = require('../data/i18n/hi');

const LANGS = ['en', 'hi'];
const COOKIE = 'lang';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// "  Minimum   300 kg " → "Minimum 300 kg"
const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();

// Placeholders: {n} {a} {b} {km} only match numbers and amounts (so "{n} rates"
// can't swallow "Other paper rates"); {x} matches a price change such as
// "₹30 (5.1%)"; any other name matches any text.
const NUMBERISH = new Set(['n', 'a', 'b', 'km']);
const placeholderRe = (name) => {
  if (NUMBERISH.has(name)) return '([₹\\d.,\\-]+)';
  if (name === 'x') return '([₹\\d.,()%\\s]+?)';
  return '(.+?)';
};

const exact = new Map();
const lower = new Map();
const patterns = [];
Object.entries(HI).forEach(([en, hi]) => {
  const key = normalize(en);
  if (!/\{\w+\}/.test(key)) {
    exact.set(key, hi);
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), hi);
    return;
  }
  const names = [];
  let literal = 0;
  const source = key.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) {
      literal += part.length;
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    names.push(m[1]);
    return placeholderRe(m[1]);
  }).join('');
  patterns.push({
    re: new RegExp(`^${source}$`), names, hi, literal,
  });
});
// The pattern with the most fixed words wins.
patterns.sort((p, q) => q.literal - p.literal);

function translateText(text, depth = 0) {
  const key = normalize(text);
  if (!key) return null;
  if (exact.has(key)) return exact.get(key);
  if (depth > 0 && lower.has(key.toLowerCase())) return lower.get(key.toLowerCase());
  if (depth > 2) return null;
  for (const p of patterns) {
    const m = p.re.exec(key);
    if (m) {
      let out = p.hi;
      // Each changing part is translated too when it can be (an area, a scrap name…).
      p.names.forEach((name, i) => {
        const value = m[i + 1];
        out = out.split(`{${name}}`).join(translateText(value, depth + 1) ?? value);
      });
      return out;
    }
  }
  return null;
}

// HTML entities as they appear in the rendered page.
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ATTRS = /(\s(?:placeholder|title|aria-label|alt|data-lot-title)=")([^"]*)(")/g;
const META = /(<meta\s+(?:name="description"|property="og:(?:title|description)"|name="twitter:(?:title|description)")\s+content=")([^"]*)(")/g;
const SKIP_BLOCKS = /<(script|style|textarea|code|pre)\b[\s\S]*?<\/\1>/gi;

// Translate a finished English page into Hindi.
function translateHtml(html) {
  // Keep scripts, styles and typed-in text exactly as they are.
  const kept = [];
  let out = html.replace(SKIP_BLOCKS, (block) => {
    kept.push(block);
    return `\u0000${kept.length - 1}\u0000`;
  });
  // A dropdown choice without a value sends its text: pin the English text as
  // its value first, so forms still send what the server expects.
  out = out.replace(/<option(?![^>]*\svalue=)([^>]*)>([^<]*)<\/option>/g,
    (whole, attrs, text) => `<option value="${encode(decode(text).trim())}"${attrs}>${text}</option>`);
  // Text between tags.
  out = out.replace(/>([^<>]+)</g, (whole, text) => {
    if (!/[A-Za-z]/.test(text)) return whole;
    const hi = translateText(decode(text));
    if (hi == null) return whole;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return `>${lead}${encode(hi)}${trail}<`;
  });
  // Attributes people read or hear.
  const attr = (whole, before, value, after) => {
    const hi = translateText(decode(value));
    return hi == null ? whole : `${before}${encode(hi)}${after}`;
  };
  out = out.replace(ATTRS, attr).replace(META, attr);
  out = out.replace('<html lang="en-IN"', '<html lang="hi-IN"');
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)]);
}

// Which language this visit wants: ?lang= (remembered), else the cookie.
function pickLang(req, res) {
  const asked = req.query.lang;
  if (LANGS.includes(asked)) {
    res.cookie(COOKIE, asked, { maxAge: YEAR_MS, sameSite: 'lax' });
    return asked;
  }
  const cookie = (req.get('cookie') || '').match(/(?:^|;\s*)lang=(en|hi)\b/);
  return cookie ? cookie[1] : 'en';
}

// Page middleware: res.locals.lang, the addresses of this page in each
// language, and Hindi translation of everything rendered.
function middleware(req, res, next) {
  const lang = pickLang(req, res);
  res.locals.lang = lang;
  const params = new URLSearchParams(req.query);
  params.delete('lang');
  const rest = params.toString();
  res.locals.langUrl = (l) => `${req.path}?${rest ? `${rest}&` : ''}lang=${l}`;
  // The same address serves either language by cookie, so caches must tell them apart.
  res.vary('Cookie');
  if (lang === 'hi') {
    const render = res.render.bind(res);
    res.render = (view, locals, callback) => {
      const cb = typeof locals === 'function' ? locals : callback;
      const data = typeof locals === 'function' ? {} : (locals || {});
      render(view, data, (err, html) => {
        if (err) return cb ? cb(err) : next(err);
        const translated = translateHtml(html);
        return cb ? cb(null, translated) : res.send(translated);
      });
    };
  }
  next();
}

// The browser half (public/js/i18n.js): the dictionary as a script.
let clientCache = null;
function clientScript() {
  if (!clientCache) clientCache = `window.SE_HI=${JSON.stringify(HI).replace(/</g, '\\u003c')};`;
  return clientCache;
}

module.exports = {
  LANGS, middleware, translateHtml, translateText, clientScript, normalize, decode,
};
