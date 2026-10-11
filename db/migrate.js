require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 3000;
// Errors that mean "database not reachable yet" (e.g. still provisioning on a
// fresh deploy) rather than a real problem with the schema.
const TRANSIENT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', '57P03']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      break;
    } catch (err) {
      if (!TRANSIENT_CODES.has(err.code) || attempt >= MAX_ATTEMPTS) throw err;
      console.log(`Database not reachable yet (${err.code}), retrying ${attempt}/${MAX_ATTEMPTS - 1}...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.log('Database schema created/updated successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
