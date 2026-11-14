// Customers rate a finished pickup (1–5 stars, a comment, and whether we may
// show it on the website). The owner sees every rating and can publish the
// ones the customer allowed as a review on the home page.
const pool = require('../db/pool');
const push = require('./push');
const live = require('./live');

// `who` is { customerId } or { token }. Returns the request, or { error }.
async function rate(requestId, who, body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Please choose 1 to 5 stars.' };
  const comment = String(body.comment ?? '').trim().slice(0, 1000) || null;
  const allowPublic = Boolean(body.allowPublic) && Boolean(comment);
  const { rows } = await pool.query(
    `UPDATE pickup_requests p SET rating = $4, rating_comment = $5, rating_public = $6, rated_at = NOW()
     WHERE p.id = $1 AND p.status = 'completed' AND p.rated_at IS NULL
       AND (($2::int IS NOT NULL AND p.customer_id = $2) OR ($3::text IS NOT NULL AND p.quote_token = $3))
     RETURNING p.id, p.customer_id, p.quote_token, p.company_name`,
    [requestId, who.customerId ?? null, who.token ?? null, rating, comment, allowPublic]
  );
  if (!rows[0]) return { error: 'This pickup has already been rated, or is not finished yet.' };
  live.requestChanged(rows[0].customer_id, rows[0].quote_token);
  push.quietly(push.notifyAdmins({
    title: `${rating <= 2 ? '⚠️ Low rating' : 'New rating'}: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} for #${requestId}`,
    body: [rows[0].company_name, comment].filter(Boolean).join(' · ').slice(0, 180),
    url: `/admin.html#pickup-${requestId}`,
    tag: `rating-${requestId}`,
  }));
  return rows[0];
}

async function recent(limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, company_name, name, business_type, area, rating, rating_comment, rating_public, rated_at, review_id
     FROM pickup_requests WHERE rated_at IS NOT NULL ORDER BY rated_at DESC LIMIT $1`,
    [limit]
  );
  const { rows: [avg] } = await pool.query(
    "SELECT ROUND(AVG(rating)::numeric, 1) AS average, COUNT(*)::int AS count FROM pickup_requests WHERE rated_at IS NOT NULL"
  );
  return { ratings: rows, average: avg.average == null ? null : Number(avg.average), count: avg.count };
}

// Put an allowed rating on the home page as a review.
async function publish(requestId) {
  const { rows } = await pool.query(
    'SELECT * FROM pickup_requests WHERE id = $1 AND rated_at IS NOT NULL AND rating_public AND rating_comment IS NOT NULL AND review_id IS NULL',
    [requestId]
  );
  const r = rows[0];
  if (!r) return { error: 'Only ratings with a comment, that the customer allowed us to show, can be published (and only once).' };
  const area = r.area ? r.area.replace(/^Other: /, '') : null;
  const { rows: [review] } = await pool.query(
    'INSERT INTO testimonials (customer_name, company_type, area, rating, message) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [r.company_name || r.name, r.business_type, area, r.rating, r.rating_comment]
  );
  await pool.query('UPDATE pickup_requests SET review_id = $2 WHERE id = $1', [requestId, review.id]);
  live.publish('reviews');
  return { reviewId: review.id };
}

module.exports = { rate, recent, publish };
