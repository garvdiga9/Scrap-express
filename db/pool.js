require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  // Give up instead of hanging: a stuck query or an unreachable database
  // must not tie up the site.
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000,
  idle_in_transaction_session_timeout: 30000,
});

// A connection that drops while idle (database restart, network blip) is
// reported here; without this listener it would crash the whole server.
pool.on('error', (err) => {
  console.error('Database connection lost (it reconnects on the next query):', err.message);
});

module.exports = pool;
