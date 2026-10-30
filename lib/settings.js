// Read/write JSON values in the app_settings table, with a short in-memory
// cache because some settings are read on every page.
const pool = require('../db/pool');

const CACHE_MS = 30 * 1000;
const cache = new Map();

async function get(key, fallback = null) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const value = rows[0] ? JSON.parse(rows[0].value) : fallback;
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
  cache.set(key, { value, at: Date.now() });
}

// Atomically change a value only if it differs; returns true for the one
// caller that made the change (used so a daily job runs once per day).
async function claim(key, value) {
  const { rows } = await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value
     RETURNING key`,
    [key, JSON.stringify(value)]
  );
  cache.delete(key);
  return rows.length > 0;
}

module.exports = { get, set, claim };
