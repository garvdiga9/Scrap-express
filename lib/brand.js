// The business name and contact details, in one place.
//
// The code and pages are written with the current details ("Scrap Express",
// +91 98188 26333, scrapexpress@gmail.com). To rename the business or change
// the phone or email, set these on the server (Render → Environment) and
// redeploy. Nothing else needs editing:
//   BRAND_NAME         e.g. "SahiKaanta" (two words like "Scrap Express" show
//                      the second word in green in the logo)
//   BRAND_SHORT        short app-name prefix, e.g. "SK" for "SK Admin"
//   BRAND_PHONE        10-digit mobile, e.g. 9876543210
//   BRAND_EMAIL        e.g. hello@example.com
// The server swaps the current details for the new ones in everything it
// sends: pages (English and Hindi), the app files, emails, WhatsApp texts and
// app alerts. With nothing set, nothing changes.
// Not covered (change by hand when renaming): the logo images in
// public/icons, the Play Store package name (ANDROID_PACKAGE_NAME, which can't
// change once published) and the store pictures in store-assets/.
const CURRENT = {
  name: 'Scrap Express',
  short: 'SE',
  phone: '9818826333',
  email: 'scrapexpress@gmail.com',
};

// Quotes and angle brackets would break the pages, so they're dropped.
const env = (key) => (process.env[key] || '').replace(/["'`\\<>]/g, '').replace(/\s+/g, ' ').trim();
const digits = env('BRAND_PHONE').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
const BRAND = {
  name: env('BRAND_NAME') || CURRENT.name,
  short: env('BRAND_SHORT') || CURRENT.short,
  phone: /^[6-9]\d{9}$/.test(digits) ? digits : CURRENT.phone,
  email: env('BRAND_EMAIL') || CURRENT.email,
};
if (env('BRAND_PHONE') && BRAND.phone === CURRENT.phone) console.warn('BRAND_PHONE is not a valid 10-digit mobile number; keeping the current one.');

const changed = BRAND.name !== CURRENT.name || BRAND.short !== CURRENT.short || BRAND.phone !== CURRENT.phone || BRAND.email !== CURRENT.email;

// "+91 98188 26333"
const spaced = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
// The logo shows the last word in green: "Scrap <strong>Express</strong>".
const logoParts = (name) => {
  const words = name.split(' ');
  return words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [name, ''];
};

// Longest first, so "Scrap Express" inside the logo markup is handled by
// the logo rule, and the spaced phone before the bare digits.
function buildRules() {
  if (!changed) return [];
  const [first, last] = logoParts(BRAND.name);
  const [oldFirst, oldLast] = logoParts(CURRENT.name);
  const rules = [
    [`${oldFirst} <strong>${oldLast}</strong>`, last ? `${first} <strong>${last}</strong>` : `<strong>${first}</strong>`],
    [`${oldFirst} <span>${oldLast}</span>`, last ? `${first} <span>${last}</span>` : first],
    [CURRENT.name, BRAND.name],
    // Inside links, e.g. a WhatsApp message "Hi%20Scrap%20Express".
    [encodeURIComponent(CURRENT.name), encodeURIComponent(BRAND.name)],
    [CURRENT.name.replace(/\s+/g, '+'), BRAND.name.replace(/\s+/g, '+')],
    [CURRENT.name.replace(/\s+/g, ''), BRAND.name.replace(/\s+/g, '')],
    [`${CURRENT.short} Admin`, `${BRAND.short} Admin`],
    [`${CURRENT.short} Staff`, `${BRAND.short} Staff`],
    [spaced(CURRENT.phone), spaced(BRAND.phone)],
    // Search-engine data writes it "+91-98188-26333".
    [spaced(CURRENT.phone).replace(/ /g, '-'), spaced(BRAND.phone).replace(/ /g, '-')],
    [`+91${CURRENT.phone}`, `+91${BRAND.phone}`],
    [`91${CURRENT.phone}`, `91${BRAND.phone}`],
    [CURRENT.phone, BRAND.phone],
    [CURRENT.email, BRAND.email],
  ];
  return rules.filter(([from, to]) => from !== to);
}
const RULES = buildRules();

// Swaps the current details for the configured ones (no-op when unchanged).
function brandify(text) {
  if (!RULES.length || typeof text !== 'string') return text;
  let out = text;
  for (const [from, to] of RULES) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

module.exports = {
  BRAND, CURRENT, changed, brandify,
};
