// Backups: everything needed to rebuild the site somewhere else, as one
// .tar.gz file the owner downloads from the admin (Team tab).
//   backup.json            what's inside, when, and how many rows per table
//   data/<table>.json      every row of every table (not sign-in sessions)
//   files/...              the uploaded photos, videos and papers (UPLOAD_DIR),
//                          when "with photos" is chosen
// scripts/restore.js puts a backup into an empty database (and files folder).
// The file holds customer details and password hashes: keep it private.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const pool = require('../db/pool');
const settings = require('./settings');
const { UPLOAD_DIR } = require('./media');

const SKIP_TABLES = new Set(['session']); // sign-ins: nothing worth keeping
const FORMAT = 1;
const LAST_KEY = 'last_backup';

// ---- a minimal tar writer/reader (ustar), enough for our own files ----

function tarHeader(name, size, mtime = new Date()) {
  const header = Buffer.alloc(512);
  // Long paths go in the ustar "prefix" field (up to 155 + 100 characters).
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  header.write(base, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  header.write(`${Math.floor(mtime.getTime() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  header.write('        ', 148); // checksum placeholder
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}
const padding = (size) => Buffer.alloc((512 - (size % 512)) % 512);

// Writes the backup to `out` (a writable stream, e.g. the HTTP response).
async function write(out, { withFiles = false } = {}) {
  const gzip = zlib.createGzip({ level: 6 });
  gzip.pipe(out);
  const push = (chunk) => new Promise((resolve, reject) => {
    if (gzip.write(chunk)) resolve(); else gzip.once('drain', resolve);
    gzip.once('error', reject);
  });
  const addBuffer = async (name, buffer) => {
    await push(tarHeader(name, buffer.length));
    await push(buffer);
    await push(padding(buffer.length));
  };

  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const counts = {};
  for (const { table_name: table } of tables) {
    if (SKIP_TABLES.has(table)) continue;
    // The database writes the JSON itself, so dates and times come out
    // exactly as stored (no time-zone shift between computers).
    const { rows: [dump] } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(json_agg(t), '[]'::json)::text AS data FROM "${table}" t`
    );
    counts[table] = dump.n;
    await addBuffer(`data/${table}.json`, Buffer.from(dump.data));
  }

  let files = 0;
  if (withFiles) {
    const walk = async (dir, rel) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith('.') || (rel === '' && entry.name === 'tmp')) continue;
        const full = path.join(dir, entry.name);
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(full, name);
        } else if (entry.isFile()) {
          const stat = await fsp.stat(full);
          await push(tarHeader(`files/${name}`, stat.size, stat.mtime));
          for await (const chunk of fs.createReadStream(full)) await push(chunk);
          await push(padding(stat.size));
          files += 1;
        }
      }
    };
    await walk(UPLOAD_DIR, '');
  }

  const manifest = {
    format: FORMAT, createdAt: new Date().toISOString(), withFiles, files, tables: counts,
  };
  await addBuffer('backup.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  await push(Buffer.alloc(1024)); // end of archive
  await new Promise((resolve) => { gzip.end(resolve); });
  await settings.set(LAST_KEY, { at: manifest.createdAt, withFiles, files });
  return manifest;
}

// Reads a backup file. Data and the manifest go to onEntry(name, buffer);
// uploaded files are streamed straight into filesDir (when given), so big
// videos never sit in memory.
async function read(file, { onEntry, filesDir = null }) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  let header = Buffer.alloc(0); // collecting the next 512-byte header
  let entry = null; // { name, size, left, skip, chunks?, out? }
  const finish = async () => {
    if (entry.out) await new Promise((resolve, reject) => entry.out.end((err) => (err ? reject(err) : resolve())));
    else if (entry.chunks) await onEntry(entry.name, Buffer.concat(entry.chunks));
    entry = null;
  };
  const begin = async (h) => {
    const field = (startAt, len) => h.subarray(startAt, startAt + len).toString().replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    entry = { name, size, left: size, skip: (512 - (size % 512)) % 512 };
    if (name.startsWith('files/')) {
      const rel = name.slice(6);
      // Never write outside the files folder.
      const target = filesDir && path.resolve(filesDir, rel);
      if (target && target.startsWith(path.resolve(filesDir) + path.sep)) {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        entry.out = fs.createWriteStream(target);
      }
    } else {
      entry.chunks = [];
    }
    if (size === 0) entry.left = 0;
  };
  for await (let chunk of input) {
    while (chunk.length) {
      if (!entry) {
        const need = 512 - header.length;
        header = Buffer.concat([header, chunk.subarray(0, need)]);
        chunk = chunk.subarray(need);
        if (header.length < 512) break;
        const h = header;
        header = Buffer.alloc(0);
        if (h.every((b) => b === 0)) continue; // end-of-archive blocks
        await begin(h);
        if (entry.left === 0 && entry.skip === 0) await finish();
        continue;
      }
      if (entry.left > 0) {
        const part = chunk.subarray(0, entry.left);
        chunk = chunk.subarray(part.length);
        entry.left -= part.length;
        if (entry.out) {
          if (!entry.out.write(part)) await new Promise((resolve) => entry.out.once('drain', resolve));
        } else if (entry.chunks) {
          entry.chunks.push(Buffer.from(part));
        }
        if (entry.left > 0) continue;
      }
      const skip = Math.min(entry.skip, chunk.length);
      chunk = chunk.subarray(skip);
      entry.skip -= skip;
      if (entry.skip === 0) await finish();
    }
  }
}

const lastBackup = () => settings.get(LAST_KEY, null);

module.exports = {
  write, read, lastBackup, SKIP_TABLES,
};
