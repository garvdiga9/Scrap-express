// Weighbridge slips, GST invoices and other papers the team attaches to a
// request (PDF, JPEG, PNG or WebP). Stored on the uploads disk, never public:
// the customer downloads them through My Account or their private quote link.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');
const { UPLOAD_DIR } = require('./media');

const DOCS_DIR = path.join(UPLOAD_DIR, 'documents');
fs.mkdirSync(DOCS_DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = { weight_slip: 'Weighbridge slip', invoice: 'GST invoice', other: 'Document' };
const EXTENSIONS = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

function sniff(buf) {
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: DOCS_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 10 },
}).single('file');

// Middleware: one PDF or image as req.document, or 400.
function acceptDocument(req, res, next) {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file must be under 10 MB.' : 'The upload could not be completed.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Please choose a file.' });
    try {
      const handle = await fsp.open(req.file.path, 'r');
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      await handle.close();
      const mime = sniff(head);
      if (!mime) {
        await fsp.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'Please upload a PDF or a photo (JPG, PNG).' });
      }
      const fileName = req.file.filename.replace(/\.part$/, EXTENSIONS[mime]);
      await fsp.rename(req.file.path, path.join(DOCS_DIR, fileName));
      req.document = {
        fileName, mime, size: req.file.size, originalName: String(req.file.originalname || '').slice(0, 255),
      };
      next();
    } catch (readErr) {
      next(readErr);
    }
  });
}

async function add(requestType, requestId, kind, doc) {
  const { rows } = await pool.query(
    `INSERT INTO request_documents (request_type, request_id, kind, file_name, original_name, mime_type, size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [requestType, requestId, kind, doc.fileName, doc.originalName, doc.mime, doc.size]
  );
  return rows[0];
}

async function listFor(requestType, requestIds) {
  if (!requestIds.length) return [];
  const { rows } = await pool.query(
    `SELECT id, request_type, request_id, kind, original_name, mime_type, size_bytes, created_at
     FROM request_documents WHERE request_type = $1 AND request_id = ANY($2) ORDER BY created_at`,
    [requestType, requestIds]
  );
  return rows;
}

async function find(id) {
  const { rows } = await pool.query('SELECT * FROM request_documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await pool.query('DELETE FROM request_documents WHERE id = $1 RETURNING *', [id]);
  if (rows[0]) await fsp.unlink(path.join(DOCS_DIR, path.basename(rows[0].file_name))).catch(() => {});
  return rows[0] || null;
}

async function removeFiles(fileNames) {
  await Promise.all(fileNames.map((name) => fsp.unlink(path.join(DOCS_DIR, path.basename(name))).catch(() => {})));
}

// Sends the file as a download with a sensible name, e.g.
// "Scrap-Express-GST-invoice-request-12.pdf".
function send(res, doc) {
  const ext = EXTENSIONS[doc.mime_type] || '';
  const label = KINDS[doc.kind].replace(/\s+/g, '-');
  res.set('Cache-Control', 'private, no-store');
  res.download(path.join(DOCS_DIR, path.basename(doc.file_name)), `Scrap-Express-${label}-request-${doc.request_id}${ext}`);
}

module.exports = {
  KINDS, acceptDocument, add, listFor, find, remove, removeFiles, send,
};
