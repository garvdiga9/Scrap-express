require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { ensureSlugs } = require('../lib/rates');
const { AREA_PAGES } = require('../data/areas');

const defaultRates = [
  // Paper
  ['Newspaper', 'kg', 12, 'newspaper', 1],
  ['Books', 'kg', 10, 'book', 2],
  ['Cardboard / Cartons', 'kg', 8, 'box', 3],
  ['Crafts (Hardboard / Duplex)', 'kg', 6, 'hardboard', 4],
  // Plastic
  ['Plastic Pipe (PVC)', 'kg', 12, 'pipe', 5],
  ['Plastic Crystal', 'kg', 25, 'granules', 6],
  ['Plastic Sheet', 'kg', 10, 'plastic-roll', 7],
  ['Plastic Bottles (PET)', 'kg', 14, 'bottle', 8],
  ['Colourful Mixed Plastic', 'kg', 8, 'plastic-chunks', 9],
  // Iron & steel
  ['Iron / MS Scrap (Saria, Angle, Girder, Channel, Pipe)', 'kg', 24, 'rebar', 10],
  ['GI Scrap / Loha Chadar (White Loha)', 'kg', 18, 'corrugated', 11],
  ['Cast Iron (CI) Scrap', 'kg', 20, 'pipe-fitting', 12],
  ['S.S. Steel - 202', 'kg', 55, 'steel-plate', 13],
  ['S.S. Steel - 304', 'kg', 72, 'steel-plate', 14],
  // Copper & brass
  ['Copper (Pure - Pipe / Wire / Sheet / Pati)', 'kg', 620, 'copper-pipe', 15],
  ['Brass (Utensils / Parts)', 'kg', 320, 'brass-pot', 16],
  // Aluminium
  ['Aluminium Utensils', 'kg', 130, 'aluminium-pot', 17],
  ['Aluminium Section', 'kg', 150, 'beam', 18],
  ['Aluminium Motor Parts', 'kg', 140, 'gear', 19],
  // Wires
  ['Copper Wire (House / Factory PVC Fitting)', 'kg', 400, 'wire', 20],
  ['Copper Wire with Electronics (TV / Fridge / Washing Machine)', 'kg', 300, 'wire-appliance', 21],
  ['Aluminium Wire', 'kg', 150, 'wire', 22],
  ['Net Wire', 'kg', 140, 'mesh', 23],
  ['AC Wire', 'kg', 210, 'thick-cable', 24],
  // Glass & batteries
  ['Glass Bottles (Whiskey / House / Factory)', 'kg', 3, 'glass-bottle', 25],
  ['Inverter Batteries', 'piece', 800, 'battery', 26],
];

// Testimonials are deliberately not seeded: only real client reviews, added
// from the admin dashboard, should ever appear on the site.

async function seed() {
  const client = await pool.connect();
  try {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await client.query(
      `INSERT INTO admin_users (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminUsername, passwordHash]
    );
    console.log(`Admin user "${adminUsername}" is ready.`);

    const { rows: rateRows } = await client.query('SELECT COUNT(*)::int AS count FROM scrap_categories');
    if (rateRows[0].count === 0) {
      for (const [name, unit, price, icon, sort] of defaultRates) {
        await client.query(
          `INSERT INTO scrap_categories (name, unit, price, icon, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (name) DO NOTHING`,
          [name, unit, price, icon, sort]
        );
      }
      console.log('Default scrap rates inserted.');
    } else {
      console.log('Scrap categories already exist, skipping.');
    }
    // Each rate's own page address (/rates/<slug>), for any that lack one.
    await ensureSlugs(client);

    // Area pages: data/areas.js is the source; this keeps the table in step.
    for (const [i, area] of AREA_PAGES.entries()) {
      await client.query(
        `INSERT INTO service_areas (slug, name, region, intro, industries, nearby, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region, intro = EXCLUDED.intro,
           industries = EXCLUDED.industries, nearby = EXCLUDED.nearby, sort_order = EXCLUDED.sort_order, updated_at = NOW()
         WHERE (service_areas.name, service_areas.region, service_areas.intro, service_areas.industries, service_areas.nearby, service_areas.sort_order)
           IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.region, EXCLUDED.intro, EXCLUDED.industries, EXCLUDED.nearby, EXCLUDED.sort_order)`,
        [area.slug, area.name, area.region, area.intro, area.industries, area.nearby, i + 1]
      );
    }
    await client.query('DELETE FROM service_areas WHERE NOT (slug = ANY($1))', [AREA_PAGES.map((a) => a.slug)]);
    console.log(`Area pages ready (${AREA_PAGES.length}).`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
