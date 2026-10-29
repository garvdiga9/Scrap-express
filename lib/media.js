// Customer photos and videos attached to pickup and demolition requests.
// Files live on disk under UPLOAD_DIR (a Render persistent disk in
// production, ./uploads locally) and are only ever served to the admin.
// The database keeps one row per file.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');

const MB = 1024 * 1024;
const LIMITS = { photos: 6, videos: 2, photoMB: 10, videoMB: 50 };

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FIELD_KIND = { photos: 'photo', videos: 'video' };
const EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp',
};

// The browser-reported type can be anything, so the real type is read from
// the file's first bytes. Anything unrecognised is rejected.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('3g')) return 'video/3gpp';
    return 'video/mp4';
  }
  return null;
}
const kindOf = (mime) => (mime.startsWith('image/') ? 'photo' : 'video');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: {
    fileSize: LIMITS.videoMB * MB,
    files: LIMITS.photos + LIMITS.videos,
    fields: 20,
    fieldSize: 100 * 1024,
  },
  // Cheap early check on the declared type; the real check happens below.
  fileFilter: (req, file, cb) => {
    const kind = FIELD_KIND[file.fieldname];
    if (kind && file.mimetype.startsWith(kind === 'photo' ? 'image/' : 'video/')) return cb(null, true);
    const err = new Error('wrong file type');
    err.code = 'WRONG_TYPE';
    cb(err);
  },
}).fields([
  { name: 'photos', maxCount: LIMITS.photos },
  { name: 'videos', maxCount: LIMITS.videos },
]);

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `Each video must be under ${LIMITS.videoMB} MB.`,
  LIMIT_FILE_COUNT: `You can attach up to ${LIMITS.photos} photos and ${LIMITS.videos} videos.`,
  LIMIT_UNEXPECTED_FILE: `You can attach up to ${LIMITS.photos} photos and ${LIMITS.videos} videos.`,
  WRONG_TYPE: 'Please add only photos with "Add Photos" and only videos with "Add Videos".',
};

// Anyone can submit a request, so cap how often one address can upload,
// to stop the disk being filled by a script.
const UPLOADS_PER_HOUR = 10;
const recentUploads = new Map();
function overUploadLimit(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recentUploads.get(ip) || []).filter((t) => t > hourAgo);
  if (times.length >= UPLOADS_PER_HOUR) return true;
  times.push(Date.now());
  recentUploads.set(ip, times);
  if (recentUploads.size > 5000) recentUploads.clear();
  return false;
}

const removeFiles = (names) => Promise.all(
  names.map((name) => fsp.unlink(path.join(UPLOAD_DIR, path.basename(name))).catch(() => {}))
);

async function readHead(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    await handle.read(buf, 0, 16, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

// Check each uploaded file and give it its final name. Returns an error
// message, or null when every file is fine.
async function checkFiles(req) {
  const files = Object.values(req.files || {}).flat();
  req.media = [];
  for (const file of files) {
    const mime = sniff(await readHead(file.path));
    const kind = FIELD_KIND[file.fieldname];
    if (!mime || kindOf(mime) !== kind) {
      return `"${file.originalname}" isn't a supported ${kind}. Please use JPG, PNG or HEIC photos and MP4 or MOV videos.`;
    }
    if (kind === 'photo' && file.size > LIMITS.photoMB * MB) {
      return `"${file.originalname}" is larger than ${LIMITS.photoMB} MB.`;
    }
    const finalName = file.filename.replace(/\.part$/, EXTENSIONS[mime]);
    await fsp.rename(file.path, path.join(UPLOAD_DIR, finalName));
    file.filename = finalName;
    req.media.push({
      kind, mime, fileName: finalName, size: file.size,
      originalName: String(file.originalname || '').slice(0, 255),
    });
  }
  return null;
}

// Route middleware. A request sent as multipart (when the customer attached
// files) carries its form fields as one JSON "data" field, so the route sees
// the same req.body either way. Files that don't end up saved against a
// request (validation error, crash) are deleted once the response is sent.
function acceptMedia(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  if (overUploadLimit(req.ip)) {
    return res.status(429).json({ error: 'Too many uploads from your connection. Please try again in an hour, or WhatsApp us the photos.' });
  }

  res.on('finish', () => {
    if (req.mediaSaved) return;
    const names = Object.values(req.files || {}).flat().map((f) => f.filename);
    removeFiles(names);
  });

  upload(req, res, async (err) => {
    if (err) {
      const message = MULTER_MESSAGES[err.code] || 'The upload could not be completed. Please try again.';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    }
    try {
      req.body = JSON.parse(req.body.data || '{}');
    } catch (parseErr) {
      return res.status(400).json({ error: 'The form could not be read. Please try again.' });
    }
    try {
      const problem = await checkFiles(req);
      if (problem) return res.status(400).json({ error: problem });
    } catch (checkErr) {
      return next(checkErr);
    }
    next();
  });
}

// Every request needs at least one photo or video; returns an error message
// when there is none.
const missingMediaError = (req) => ((req.media && req.media.length)
  ? null
  : 'Please add at least one photo or video so we can quote accurately.');

// Record the checked files against a saved request.
async function saveForRequest(req, requestType, requestId) {
  const files = req.media || [];
  for (const f of files) {
    await pool.query(
      `INSERT INTO request_media (request_type, request_id, kind, file_name, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [requestType, requestId, f.kind, f.fileName, f.originalName, f.mime, f.size]
    );
  }
  req.mediaSaved = true;
  return files.length;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM request_media WHERE id = $1', [id]);
  return rows[0] || null;
}

async function removeForRequest(requestType, requestId) {
  const { rows } = await pool.query(
    'DELETE FROM request_media WHERE request_type = $1 AND request_id = $2 RETURNING file_name',
    [requestType, requestId]
  );
  await removeFiles(rows.map((r) => r.file_name));
}

// SQL for a JSON list of a request's files, used in the admin request lists.
const mediaListSql = (requestType, idColumn) => `COALESCE((
  SELECT json_agg(json_build_object('id', m.id, 'kind', m.kind, 'name', m.original_name, 'size', m.size_bytes) ORDER BY m.id)
  FROM request_media m WHERE m.request_type = '${requestType}' AND m.request_id = ${idColumn}
), '[]'::json)`;

const filePath = (media) => path.join(UPLOAD_DIR, path.basename(media.file_name));

module.exports = {
  LIMITS, acceptMedia, missingMediaError, saveForRequest, findById, removeForRequest, mediaListSql, filePath,
};
