// Client reviews: added by the admin, shown on the home page. Only business
// clients' reviews, each with the kind of business and the area.
const pool = require('../db/pool');

async function listReviews(limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, customer_name, company_type, area, rating, message
     FROM testimonials ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// "Factory / Manufacturing Unit · Okhla Industrial Area"
const reviewWhere = (review) => [review.company_type, review.area].filter(Boolean).join(' · ');

// "Rohan Mehta" → "RM"
function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// The same name always gets the same avatar colour.
const AVATAR_COLORS = ['#b45309', '#15803d', '#1d4ed8', '#be185d', '#6d28d9', '#0f766e', '#b91c1c', '#a16207'];
function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash); // eslint-disable-line no-bitwise
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

module.exports = {
  listReviews, reviewWhere, initialsFor, colorForName,
};
