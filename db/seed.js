require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

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

const defaultTestimonials = [
  ['Rohit Sharma', 'Dwarka', 5, 'Booked a pickup in the morning and their team arrived by evening. Weighing was completely transparent and I got paid in cash on the spot.'],
  ['Anita Verma', 'Rohini', 5, 'Best rates I have found for old newspapers and cardboard compared to the local kabadiwala. Very professional service.'],
  ['Mohd. Irfan', 'Lajpat Nagar', 4, 'Cleared out a whole room of old electronics and metal scrap. Quick response and fair pricing.'],
  ['Priya Nanda', 'Vasant Kunj', 5, 'Loved how easy it was to book online instead of waiting for a cart to pass by. Highly recommend for busy families.'],
];

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

    const { rows: testRows } = await client.query('SELECT COUNT(*)::int AS count FROM testimonials');
    if (testRows[0].count === 0) {
      for (const [name, area, rating, message] of defaultTestimonials) {
        await client.query(
          `INSERT INTO testimonials (customer_name, area, rating, message) VALUES ($1,$2,$3,$4)`,
          [name, area, rating, message]
        );
      }
      console.log('Sample testimonials inserted.');
    } else {
      console.log('Testimonials already exist, skipping.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
