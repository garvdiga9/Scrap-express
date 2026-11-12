// "Buy from us": lots of sorted, baled scrap the business sells to recyclers.
const pool = require('../db/pool');
const siteImages = require('./site-images');

const LOT_MATERIALS = [
  'Kraft paper', 'Mixed paper & cardboard', 'Newspaper', 'PET bottles', 'HDPE / LDPE plastic',
  'GI sheet', 'MS / HMS steel', 'Stainless steel', 'Aluminium', 'Copper', 'Brass', 'E-waste', 'Other',
];
const LOT_UNITS = ['kg', 'tonnes', 'bales', 'pieces'];
const LOT_STATUSES = ['available', 'reserved', 'sold'];

const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// Admin form → { lot } or { error }.
function parseLot(body) {
  const lot = {
    material: text(body.material, 100),
    title: text(body.title, 150),
    grade: text(body.grade, 150) || null,
    quantity: Number(body.quantity),
    unit: body.unit,
    location: text(body.location, 150) || null,
    description: String(body.description ?? '').trim().slice(0, 2000) || null,
    status: body.status || 'available',
  };
  if (!LOT_MATERIALS.includes(lot.material)) return { error: 'Please choose the material.' };
  if (!lot.title) return { error: 'Please give the lot a short title.' };
  if (!Number.isFinite(lot.quantity) || lot.quantity <= 0) return { error: 'Please enter the quantity.' };
  if (!LOT_UNITS.includes(lot.unit)) return { error: 'Please choose a unit.' };
  if (!LOT_STATUSES.includes(lot.status)) return { error: 'Please choose a status.' };
  return { lot };
}

async function withImages(rows) {
  if (!rows.length) return rows;
  const { rows: images } = await pool.query(
    "SELECT * FROM site_images WHERE kind = 'lot' AND lot_id = ANY($1) ORDER BY sort_order, created_at",
    [rows.map((r) => r.id)]
  );
  return rows.map((lot) => ({
    ...lot,
    quantity: Number(lot.quantity),
    images: images.filter((img) => img.lot_id === lot.id).map((img) => ({ ...img, url: siteImages.urlFor(img) })),
  }));
}

async function listLots({ includeSold = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM sale_lots WHERE $1 OR status <> 'sold'
     ORDER BY CASE status WHEN 'available' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, updated_at DESC`,
    [includeSold]
  );
  return withImages(rows);
}

async function getLot(id) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query('SELECT * FROM sale_lots WHERE id = $1', [id]);
  return rows[0] ? (await withImages(rows))[0] : null;
}

async function createLot(lot) {
  const { rows } = await pool.query(
    `INSERT INTO sale_lots (material, title, grade, quantity, unit, location, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [lot.material, lot.title, lot.grade, lot.quantity, lot.unit, lot.location, lot.description, lot.status]
  );
  return (await withImages(rows))[0];
}

async function updateLot(id, lot) {
  const { rows } = await pool.query(
    `UPDATE sale_lots SET material = $1, title = $2, grade = $3, quantity = $4, unit = $5, location = $6,
            description = $7, status = $8, updated_at = NOW()
     WHERE id = $9 RETURNING *`,
    [lot.material, lot.title, lot.grade, lot.quantity, lot.unit, lot.location, lot.description, lot.status, id]
  );
  return rows[0] ? (await withImages(rows))[0] : null;
}

async function deleteLot(id) {
  const { rows } = await pool.query("SELECT file_name FROM site_images WHERE kind = 'lot' AND lot_id = $1", [id]);
  await pool.query('DELETE FROM sale_lots WHERE id = $1', [id]); // photo rows go with it
  await siteImages.removeFiles(rows.map((r) => r.file_name));
}

// "2.5 tonnes", "40 bales"
const formatQuantity = (lot) => `${Number(lot.quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${lot.unit}`;

module.exports = {
  LOT_MATERIALS, LOT_UNITS, LOT_STATUSES, parseLot, listLots, getLot, createLot, updateLot, deleteLot, formatQuantity,
};
