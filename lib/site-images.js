// Photos the owner adds for the public site: the yard, weighbridge, trucks
// and team (home page), client logos (only with the client's permission),
// and photos of lots for sale on "Buy from us". The admin's browser turns
// every image into WebP before upload; the server only accepts WebP, reads
// its size from the file, and stores it on the uploads disk. They're public,
// served from /site-images/<file>.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');
const { UPLOAD_DIR } = require('./media');

const SITE_DIR = path.join(UPLOAD_DIR, 'site');
fs.mkdirSync(SITE_DIR, { recursive: true });

const MAX_BYTES = 3 * 1024 * 1024;
const KINDS = ['gallery', 'logo', 'lot'];
const GALLERY_CATEGORIES = [
  { key: 'yard', label: 'Our yard' },
  { key: 'weighbridge', label: 'Weighbridge' },
  { key: 'trucks', label: 'Trucks & loading' },
  { key: 'team', label: 'Our team' },
  { key: 'other', label: 'Other' },
];

const upload = multer({
  storage: multer.diskStorage({
    destination: SITE_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 20 },
}).single('image');

// Width and height from a WebP file's header (lossy, lossless or extended).
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }; // eslint-disable-line no-bitwise
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; // eslint-disable-line no-bitwise
  }
  if (chunk === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// Express middleware: accepts one WebP image as req.image, or answers 400.
function acceptImage(req, res, next) {
  upload(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'The image must be under 3 MB.' : 'The upload could not be completed.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Please choose an image.' });
    try {
      const handle = await fsp.open(req.file.path, 'r');
      const head = Buffer.alloc(32);
      await handle.read(head, 0, 32, 0);
      await handle.close();
      const size = webpSize(head);
      if (!size || !size.width || !size.height) {
        await fsp.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'Please upload a photo (it is turned into WebP automatically).' });
      }
      const fileName = req.file.filename.replace(/\.part$/, '.webp');
      await fsp.rename(req.file.path, path.join(SITE_DIR, fileName));
      req.image = { fileName, ...size, bytes: req.file.size };
      next();
    } catch (readErr) {
      next(readErr);
    }
  });
}

const urlFor = (image) => `/site-images/${encodeURIComponent(image.file_name)}`;
const withUrl = (rows) => rows.map((row) => ({ ...row, url: urlFor(row) }));

async function list(kind, { lotId } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM site_images WHERE kind = $1 AND ($2::int IS NULL OR lot_id = $2)
     ORDER BY sort_order, created_at`,
    [kind, lotId ?? null]
  );
  return withUrl(rows);
}

async function add(fields) {
  const { rows } = await pool.query(
    `INSERT INTO site_images (kind, category, alt_text, caption, company_name, permission_confirmed, lot_id,
                              file_name, width, height, size_bytes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM site_images WHERE kind = $1::varchar))
     RETURNING *`,
    [fields.kind, fields.category || null, fields.altText, fields.caption || null, fields.companyName || null,
      Boolean(fields.permissionConfirmed), fields.lotId || null,
      fields.image.fileName, fields.image.width, fields.image.height, fields.image.bytes]
  );
  return withUrl(rows)[0];
}

async function remove(id) {
  const { rows } = await pool.query('DELETE FROM site_images WHERE id = $1 RETURNING file_name', [id]);
  await Promise.all(rows.map((r) => fsp.unlink(path.join(SITE_DIR, path.basename(r.file_name))).catch(() => {})));
  return rows.length > 0;
}

// Files of images deleted along with their lot (ON DELETE CASCADE removes the rows).
async function removeFiles(fileNames) {
  await Promise.all(fileNames.map((name) => fsp.unlink(path.join(SITE_DIR, path.basename(name))).catch(() => {})));
}

module.exports = {
  SITE_DIR, KINDS, GALLERY_CATEGORIES, acceptImage, list, add, remove, removeFiles, urlFor,
};
