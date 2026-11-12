// Area pages (/areas/<slug>) from the service_areas table.
const pool = require('../db/pool');

async function listAreas() {
  const { rows } = await pool.query(
    'SELECT slug, name, region, updated_at FROM service_areas ORDER BY sort_order, name'
  );
  return rows;
}

// One area with the names of its nearby areas, or null.
async function getArea(slug) {
  const { rows } = await pool.query('SELECT * FROM service_areas WHERE slug = $1', [slug]);
  const area = rows[0];
  if (!area) return null;
  const { rows: nearby } = await pool.query(
    'SELECT slug, name FROM service_areas WHERE slug = ANY($1) ORDER BY array_position($1, slug)',
    [area.nearby]
  );
  return { ...area, nearbyAreas: nearby };
}

// Questions and answers for an area page (shown, and sent to search engines).
function areaFaqs(area, { minPickupKg, serviceKm }) {
  return [
    [`Do you buy scrap in ${area.name}?`,
      `Yes. Scrap Express buys bulk scrap from factories, offices, shops and institutions in ${area.name} and across ${area.region}: paper and cardboard, plastic, iron and steel, copper, brass and aluminium, e-waste, old ACs, generators, furniture and mixed industrial scrap.`],
    [`What is the minimum quantity for a pickup in ${area.name}?`,
      `${minPickupKg} kg per pickup. You can add several kinds of scrap together to reach it. We collect within ${serviceKm} km of Delhi, which includes ${area.name}.`],
    [`How are scrap rates worked out for ${area.name}?`,
      'Our Scrap Rates page shows today\'s indicative rates per kg. For a business lot we send a quote based on the material, grade, quantity and location; the final amount comes from the weighbridge weight at pickup, with a GST invoice.'],
    [`How do I get paid for scrap from ${area.name}?`,
      'By cash or bank transfer, whichever you prefer, on the weighbridge weight, with a GST invoice for your accounts.'],
  ];
}

module.exports = { listAreas, getArea, areaFaqs };
