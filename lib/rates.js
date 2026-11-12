// Scrap rates for the public pages: the current price, the group it's in
// (the Rates page tabs), its own page (/rates/<slug>), a photo or tinted icon,
// and how the price moved over the last 30 days (from rate_history, which
// the database fills in on every price change; see db/schema.sql).
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const settings = require('./settings');
const { RATE_CATEGORIES } = require('../data/business');

const TREND_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- photos: public/images/rates/<name or icon>.jpg|png|webp ----

const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'rates');
const IMAGE_EXTS = ['.webp', '.jpg', '.jpeg', '.png'];
const IMAGE_CACHE_MS = 10000;
let imageCache = { at: 0, map: {} };

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// "<file name without extension>" → "/images/rates/<file>" for photos that
// exist, so a page never asks for an image that isn't there. WebP wins when
// both a WebP and a JPEG of the same name are present.
function availableImages() {
  if (Date.now() - imageCache.at < IMAGE_CACHE_MS) return imageCache.map;
  const map = {};
  try {
    const files = fs.readdirSync(IMAGE_DIR)
      .filter((file) => IMAGE_EXTS.includes(path.extname(file).toLowerCase()))
      .sort((a, b) => IMAGE_EXTS.indexOf(path.extname(a).toLowerCase()) - IMAGE_EXTS.indexOf(path.extname(b).toLowerCase()));
    files.forEach((file) => {
      const key = slugify(path.basename(file, path.extname(file)));
      if (!map[key]) map[key] = `/images/rates/${encodeURIComponent(file)}`;
    });
  } catch (err) {
    // Folder missing or unreadable: every card falls back to its icon.
  }
  imageCache = { at: Date.now(), map };
  return map;
}

// ---- icons and their colours ----

const SPRITE_ICONS = new Set((() => {
  try {
    const sprite = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'sprite.ejs'), 'utf8');
    return [...sprite.matchAll(/id="icon-([a-z0-9-]+)"/g)].map((m) => m[1]);
  } catch (err) {
    return [];
  }
})());

const ICON_FAMILY = {
  newspaper: 'paper', book: 'paper', box: 'paper', hardboard: 'paper', paper: 'paper',
  pipe: 'plastic', granules: 'plastic', 'plastic-roll': 'plastic', bottle: 'plastic', 'plastic-chunks': 'plastic', plastic: 'plastic',
  rebar: 'metal', corrugated: 'metal', 'pipe-fitting': 'metal', 'steel-plate': 'metal', metal: 'metal', ewaste: 'metal',
  'copper-pipe': 'copper', 'brass-pot': 'brass', 'aluminium-pot': 'aluminium', beam: 'aluminium', gear: 'aluminium',
  wire: 'wire', 'wire-appliance': 'wire', mesh: 'wire', 'thick-cable': 'wire',
  'glass-bottle': 'glass', battery: 'battery',
};
const FAMILY_COLORS = {
  paper: { bg: '#fef3c7', fg: '#92400e' },
  plastic: { bg: '#dbeafe', fg: '#1e40af' },
  metal: { bg: '#e2e8f0', fg: '#334155' },
  copper: { bg: '#ffedd5', fg: '#9a3412' },
  brass: { bg: '#fef9c3', fg: '#854d0e' },
  aluminium: { bg: '#f1f5f9', fg: '#475569' },
  wire: { bg: '#e0e7ff', fg: '#3730a3' },
  glass: { bg: '#ccfbf1', fg: '#115e59' },
  battery: { bg: '#fee2e2', fg: '#991b1b' },
};

const iconFor = (icon) => (SPRITE_ICONS.has(icon) ? `icon-${icon}` : 'icon-recycle');
const colorsFor = (icon) => FAMILY_COLORS[ICON_FAMILY[icon]] || FAMILY_COLORS.metal;

// ---- each rate's own page address ----

// "Copper (Pure - Pipe / Wire)" → "Copper" (for page titles).
const shortName = (name) => String(name).split('(')[0].trim() || String(name);


// "Copper (Pure - Pipe / Wire)" → "copper-scrap-rate-delhi"
function slugFor(name) {
  const short = String(name).split('(')[0].replace(/\bS\.\s?S\.?(?=\s)/i, 'Stainless');
  const base = slugify(short) || 'scrap';
  return /(^|-)scrap$/.test(base) ? `${base}-rate-delhi` : `${base}-scrap-rate-delhi`;
}

// Give every rate without a page address one (new rates, and existing ones
// the first time this runs). Addresses never change afterwards, so links and
// search results keep working even if a rate is renamed.
async function ensureSlugs(db = pool) {
  const { rows } = await db.query('SELECT id, name, slug FROM scrap_categories ORDER BY sort_order, id');
  const taken = new Set(rows.map((r) => r.slug).filter(Boolean));
  for (const row of rows.filter((r) => !r.slug)) {
    const base = slugFor(row.name);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    await db.query('UPDATE scrap_categories SET slug = $1 WHERE id = $2', [slug, row.id]);
  }
}

// ---- 30-day trend ----

async function historySince(days, categoryId = null) {
  const since = new Date(Date.now() - days * DAY_MS);
  const { rows } = await pool.query(
    `SELECT category_id, price, recorded_at FROM rate_history
       WHERE recorded_at >= $1 AND ($2::int IS NULL OR category_id = $2)
     UNION ALL
     SELECT * FROM (
       SELECT DISTINCT ON (category_id) category_id, price, recorded_at FROM rate_history
       WHERE recorded_at < $1 AND ($2::int IS NULL OR category_id = $2)
       ORDER BY category_id, recorded_at DESC
     ) before_window
     ORDER BY category_id, recorded_at`,
    [since, categoryId]
  );
  const byCategory = new Map();
  rows.forEach((r) => {
    if (!byCategory.has(r.category_id)) byCategory.set(r.category_id, []);
    byCategory.get(r.category_id).push({ price: Number(r.price), at: new Date(r.recorded_at) });
  });
  return { since, byCategory };
}

// The price at each day across the window (the last known price that day).
function dailyPrices(points, current, since, days) {
  const out = [];
  for (let d = 0; d <= days; d++) {
    const at = Math.min(since.getTime() + d * DAY_MS, Date.now());
    let price = points.length ? points[0].price : current;
    points.forEach((p) => { if (p.at.getTime() <= at) price = p.price; });
    out.push(price);
  }
  out[out.length - 1] = current;
  return out;
}

// A small line drawing of the prices (SVG path in a 120 × 32 box).
function sparkPath(values, width = 120, height = 32) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const y = (v) => (max === min ? height / 2 : pad + (height - 2 * pad) * (1 - (v - min) / (max - min)));
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
}

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function trendFor(points, current, since, days = TREND_DAYS) {
  const values = dailyPrices(points, current, since, days);
  const start = values[0];
  const change = current - start;
  const pct = start > 0 ? (change / start) * 100 : 0;
  const direction = Math.abs(change) < 0.005 ? 'flat' : (change > 0 ? 'up' : 'down');
  const pctText = `${Math.abs(pct).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return {
    direction,
    start,
    change,
    pct,
    values,
    path: sparkPath(values),
    label: direction === 'flat'
      ? `No change in ${days} days`
      : `${direction === 'up' ? '▲' : '▼'} ${rupees(Math.abs(change))} (${pctText}) in ${days} days`,
  };
}

// ---- what the pages use ----

const CATEGORY_LABELS = Object.fromEntries(RATE_CATEGORIES.map((c) => [c.key, c.label]));

function decorate(row, images, history) {
  const price = Number(row.price);
  const category = CATEGORY_LABELS[row.category] ? row.category : 'other';
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    price,
    priceText: Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    icon: row.icon,
    iconId: iconFor(row.icon),
    colors: colorsFor(row.icon),
    image: images[slugify(row.name)] || images[slugify(row.icon)] || null,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    slug: row.slug,
    url: row.slug ? `/rates/${row.slug}` : null,
    updatedAt: row.updated_at,
    trend: trendFor(history.byCategory.get(row.id) || [], price, history.since),
  };
}

// When the rates were last changed, or confirmed unchanged from the admin.
async function lastUpdated() {
  const [{ rows }, checked] = await Promise.all([
    pool.query('SELECT MAX(recorded_at) AS at FROM rate_history'),
    settings.get('rates_checked_at', null).catch(() => null),
  ]);
  const times = [rows[0].at, checked].filter(Boolean).map((t) => new Date(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

async function markChecked() {
  await settings.set('rates_checked_at', new Date().toISOString());
}

async function listRates() {
  const [{ rows }, history] = await Promise.all([
    pool.query('SELECT * FROM scrap_categories ORDER BY sort_order ASC, name ASC'),
    historySince(TREND_DAYS),
  ]);
  const images = availableImages();
  return rows.map((row) => decorate(row, images, history));
}

async function getRateBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM scrap_categories WHERE slug = $1', [slug]);
  if (!rows[0]) return null;
  const history = await historySince(TREND_DAYS, rows[0].id);
  return decorate(rows[0], availableImages(), history);
}

// "12 Nov 2026, 9:05 am" in India time.
const formatIndiaTime = (date) => new Date(date).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
});

module.exports = {
  listRates, getRateBySlug, lastUpdated, markChecked, ensureSlugs, slugFor, slugify, shortName, formatIndiaTime,
  RATE_CATEGORIES, TREND_DAYS,
};
