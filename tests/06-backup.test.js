// Backups: download one, restore it into a brand-new empty database and
// files folder, and check that everything came back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const {
  BASE, pool, adminLogin, makeRequest, client, cleanUp,
} = require('./helpers');
const { UPLOAD_DIR } = require('../lib/media');

const RESTORE_DB = 'scrap_restore_test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-backup-test-'));
const marker = path.join(UPLOAD_DIR, 'site', 'test-backup-marker.jpg');
const restoreUrl = () => {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `/${RESTORE_DB}`;
  return u.toString();
};
async function admin(sql) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

after(async () => {
  fs.rmSync(marker, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB}`).catch(() => {});
  await cleanUp();
  await pool.end();
});

test('a backup restores completely into an empty database', async () => {
  const owner = await adminLogin();
  await makeRequest({ company: 'Test Backup Co' });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, Buffer.from('test file contents for the backup'));

  // Download (with files), as the owner's browser would.
  const res = await fetch(`${BASE}/api/admin/backup?files=1`, { headers: { Cookie: owner.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /site-backup-.*-with-photos\.tar\.gz/);
  const file = path.join(tmp, 'backup.tar.gz');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  assert.ok((await owner.get('/api/admin/backup/status')).data.last, 'last backup recorded');

  // Restore into a new, empty database and files folder.
  await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  await admin(`CREATE DATABASE ${RESTORE_DB}`);
  const files = path.join(tmp, 'files');
  const env = { ...process.env, DATABASE_URL: restoreUrl(), UPLOAD_DIR: files };
  const run = spawnSync(process.execPath, ['scripts/restore.js', file], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  // Every table has the same number of rows as the live database had.
  const restored = new Client({ connectionString: restoreUrl() });
  await restored.connect();
  try {
    const { rows: tables } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'session'"
    );
    for (const { table_name: t } of tables) {
      // (The "last backup" date and its activity-log line are written after
      // the backup is made, so they aren't inside it.)
      const skip = { app_settings: " WHERE key <> 'last_backup'", admin_activity: " WHERE area IS DISTINCT FROM 'backup'" }[t] || '';
      const [{ rows: [a] }, { rows: [b] }] = await Promise.all([pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"${skip}`), restored.query(`SELECT COUNT(*)::int AS n FROM "${t}"${skip}`)]);
      assert.equal(b.n, a.n, `rows in ${t}`);
    }
    const { rows: [req] } = await restored.query("SELECT company_name, quote_items, created_at FROM pickup_requests WHERE company_name = 'Test Backup Co'");
    const { rows: [orig] } = await pool.query("SELECT quote_items, created_at FROM pickup_requests WHERE company_name = 'Test Backup Co'");
    assert.deepEqual(req.quote_items, orig.quote_items);
    assert.equal(req.created_at.getTime(), orig.created_at.getTime(), 'times are exact');
    // New rows carry on numbering after the restored ones.
    const { rows: [n] } = await restored.query("INSERT INTO pickup_requests (company_name, name, phone, address, scrap_type, approx_quantity) VALUES ('Test New', 'x', '9811122233', 'x', 'x', '1') RETURNING id");
    const { rows: [max] } = await pool.query('SELECT MAX(id) AS m FROM pickup_requests');
    assert.ok(n.id > max.m);
  } finally {
    await restored.end();
  }
  assert.equal(fs.readFileSync(path.join(files, 'site', 'test-backup-marker.jpg'), 'utf8'), 'test file contents for the backup');

  // A database that already has data is not overwritten by accident.
  const again = spawnSync(process.execPath, ['scripts/restore.js', file], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already has requests or customers/);
});

test('only the owner can download backups', async () => {
  const owner = await adminLogin();
  const made = await owner.post('/api/admin/team', { name: 'Test Backup Mgr', username: 'testbackupmgr', password: 'mgr-pass-123' });
  const res = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'testbackupmgr', password: 'mgr-pass-123' }) });
  await res.text();
  const mgr = client(res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid')));
  assert.equal((await mgr.get('/api/admin/backup')).status, 403);
  assert.ok(!(await mgr.get('/api/admin/todo')).data.some((t) => t.ownerOnly), 'managers are not reminded about backups');
  assert.equal((await client().get('/api/admin/backup')).status, 401);
  await owner.del(`/api/admin/team/${made.data.id}`);
});
