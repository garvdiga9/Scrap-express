const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const pool = require('../db/pool');

const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'rates');
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const IMAGE_CACHE_MS = 10000;

let imageCache = { at: 0, map: {} };

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Maps "<filename without extension>" -> "/images/rates/<file>" for photos that
// actually exist, so the page never requests an image that isn't there.
function availableImages() {
  if (Date.now() - imageCache.at < IMAGE_CACHE_MS) return imageCache.map;
  const map = {};
  try {
    for (const file of fs.readdirSync(IMAGE_DIR)) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      const key = slugify(path.basename(file, path.extname(file)));
      if (!map[key]) map[key] = `/images/rates/${encodeURIComponent(file)}`;
    }
  } catch (err) {
    /* folder missing or unreadable - every card falls back to its icon */
  }
  imageCache = { at: Date.now(), map };
  return map;
}

// GET /api/rates - public list of scrap categories with current buying price
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, unit, price, icon FROM scrap_categories ORDER BY sort_order ASC, name ASC'
    );
    const images = availableImages();
    res.json(rows.map((row) => ({
      ...row,
      image: images[slugify(row.name)] || images[slugify(row.icon)] || null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rates' });
  }
});

module.exports = router;
