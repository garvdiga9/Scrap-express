// The numbers on the home page (hero stats and "Our Impact"). The owner
// keeps them current in Admin → Reviews → Home Page Numbers; they're stored
// in app_settings. CO₂ and trees are worked out from the kilograms recycled.
const settings = require('./settings');

const KEY = 'site_stats';

const FIELDS = {
  yearsInDelhi: { label: 'Years in Delhi', fallback: 35 },
  locationsServed: { label: 'Locations served', fallback: 100 },
  tonsPerMonth: { label: 'Tonnes recycled per month', fallback: 500 },
  clientsServed: { label: 'Clients served (total)', fallback: 10000 },
  kgRecycled: { label: 'Kg of scrap recycled (total)', fallback: 185000 },
};
const MAX_VALUE = 1e9;

// Standard recycling benchmarks: about 1.3 kg of CO₂ avoided per kg of mixed
// scrap, and about 17 trees per tonne of paper.
const CO2_KG_PER_KG = 1.3;
const TREES_PER_TONNE = 17;

async function getStats() {
  const saved = await settings.get(KEY, {}).catch((err) => {
    console.error('reading site stats failed', err);
    return {};
  });
  const stats = {};
  Object.entries(FIELDS).forEach(([key, { fallback }]) => {
    stats[key] = Number.isFinite(saved[key]) ? saved[key] : fallback;
  });
  stats.co2Tonnes = Math.round((stats.kgRecycled * CO2_KG_PER_KG) / 1000);
  stats.treesSaved = Math.round((stats.kgRecycled / 1000) * TREES_PER_TONNE);
  stats.updatedAt = saved.updatedAt || null;
  return stats;
}

// Returns { stats } or { error }.
async function saveStats(input) {
  const values = {};
  for (const [key, { label }] of Object.entries(FIELDS)) {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < 0 || value > MAX_VALUE) {
      return { error: `${label} must be a whole number.` };
    }
    values[key] = value;
  }
  await settings.set(KEY, { ...values, updatedAt: new Date().toISOString() });
  return { stats: await getStats() };
}

module.exports = { getStats, saveStats, FIELDS };
