// npm test: prepares the database, starts the site on a spare port, runs
// every tests/*.test.js against it one file at a time, then stops the site.
// Uses DATABASE_URL (from .env locally, from the workflow on GitHub).
// Never point it at the live database: the tests create and delete data.
require('dotenv').config();
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '3999';
const BASE = `http://localhost:${PORT}`;

if (/render\.com|onrender/.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at Render. Tests must use a local or test database.');
  process.exit(1);
}

const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'test',
  UPLOAD_DIR: process.env.UPLOAD_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'se-test-uploads-')),
  TEST_BASE_URL: BASE,
};

for (const step of ['db/migrate.js', 'db/seed.js']) {
  const r = spawnSync(process.execPath, [step], { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch (err) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The site did not start on ${BASE}.\n${serverLog}`);
}

(async () => {
  let code = 1;
  try {
    await waitForServer();
    const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('tests', f));
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: ROOT, env, stdio: 'inherit' });
    code = run.status;
  } catch (err) {
    console.error(err.message);
  } finally {
    server.kill();
  }
  if (code !== 0 && process.env.CI) console.log(`\n--- server log ---\n${serverLog.slice(-4000)}`);
  process.exit(code);
})();
