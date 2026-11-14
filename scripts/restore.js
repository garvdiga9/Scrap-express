// Puts a backup (downloaded from Admin → Team → Backups) into a database,
// for moving to a new host or recovering after a loss:
//
//   DATABASE_URL=postgres://... UPLOAD_DIR=/path/to/uploads node scripts/restore.js backup.tar.gz
//
// It first sets up the tables (db/migrate.js), then replaces their contents
// with the backup's, and copies the uploaded files into UPLOAD_DIR. To protect
// a working site it refuses a database that already has requests or
// customers, unless you add --replace-existing-data.
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

const file = process.argv[2];
const replace = process.argv.includes('--replace-existing-data');
if (!file) {
  console.error('Usage: node scripts/restore.js <backup.tar.gz> [--replace-existing-data]');
  process.exit(1);
}

const migrate = spawnSync(process.execPath, [path.join(__dirname, '..', 'db', 'migrate.js')], { stdio: 'inherit', env: process.env });
if (migrate.status !== 0) process.exit(migrate.status || 1);

const pool = require('../db/pool');
const backup = require('../lib/backup');
const { UPLOAD_DIR } = require('../lib/media');

// Tables in an order where every table comes after the ones it points to.
async function tableOrder(tables) {
  const { rows } = await pool.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );
  const parents = new Map(tables.map((t) => [t, new Set()]));
  rows.forEach(({ child, parent }) => { if (parents.has(child) && parents.has(parent) && child !== parent) parents.get(child).add(parent); });
  const ordered = [];
  const visit = (t, seen = new Set()) => {
    if (ordered.includes(t) || seen.has(t)) return;
    seen.add(t);
    parents.get(t).forEach((p) => visit(p, seen));
    ordered.push(t);
  };
  tables.forEach((t) => visit(t));
  return ordered;
}

(async () => {
  const data = new Map();
  let manifest = null;
  console.log(`Reading ${file}…`);
  await backup.read(file, {
    filesDir: UPLOAD_DIR,
    onEntry: async (name, buffer) => {
      if (name === 'backup.json') manifest = JSON.parse(buffer.toString());
      else if (name.startsWith('data/')) data.set(name.slice(5, -5), buffer.toString());
    },
  });
  if (!manifest) throw new Error('This is not a site backup (no backup.json inside).');
  console.log(`Backup from ${manifest.createdAt}: ${Object.keys(manifest.tables).length} tables${manifest.withFiles ? `, ${manifest.files} files copied to ${UPLOAD_DIR}` : ''}.`);

  const { rows: existing } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const here = new Set(existing.map((r) => r.table_name));
  const tables = [...data.keys()].filter((t) => here.has(t));
  const missing = [...data.keys()].filter((t) => !here.has(t));
  if (missing.length) console.warn(`Not in this database (skipped): ${missing.join(', ')}`);

  if (!replace) {
    const { rows: [busy] } = await pool.query('SELECT (SELECT COUNT(*) FROM pickup_requests) + (SELECT COUNT(*) FROM customers) AS n');
    if (Number(busy.n) > 0) {
      throw new Error('This database already has requests or customers. Restore into an empty database, or add --replace-existing-data if you are sure.');
    }
  }

  const ordered = await tableOrder(tables);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${ordered.map((t) => `"${t}"`).join(', ')} CASCADE`);
    for (const table of ordered) {
      const rows = JSON.parse(data.get(table));
      if (!rows.length) continue;
      const { rows: cols } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]
      );
      // Columns in both the backup and this database (newer columns keep their defaults).
      const columns = cols.map((c) => c.column_name).filter((c) => c in rows[0]).map((c) => `"${c}"`).join(', ');
      await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      await client.query(
        `INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::"${table}", $1::json)`,
        [data.get(table)]
      );
      await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      // Numbering carries on after the restored rows.
      const { rows: serials } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval%'", [table]
      );
      for (const { column_name: col } of serials) {
        await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', '${col}'), COALESCE(MAX("${col}"), 1), MAX("${col}") IS NOT NULL) FROM "${table}"`);
      }
      console.log(`  ${table}: ${rows.length}`);
    }
    await client.query('COMMIT');
    console.log('Restore complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
});
