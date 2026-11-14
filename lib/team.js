// Dashboard logins: one owner (the ADMIN_USERNAME / ADMIN_PASSWORD from the
// environment, set up by db/seed.js) and any number of managers the owner
// adds in the Team tab. Managers do the daily work; only the owner can
// delete things, manage logins and staff accounts, and read the activity log.
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const USERNAME = /^[a-z0-9._-]{3,50}$/;
const MIN_PASSWORD = 8;

const list = async () => (await pool.query(
  `SELECT id, COALESCE(name, username) AS name, username, role, active, last_login_at, created_at
   FROM admin_users ORDER BY (role = 'owner') DESC, active DESC, name, username`
)).rows;

// Signs a person out everywhere (all their dashboard sessions).
async function endSessions(adminId) {
  await pool.query("DELETE FROM session WHERE sess->>'adminId' = $1", [String(adminId)]).catch(() => {});
}

// Add (id null) or change a manager. Returns { user } or { error }.
async function save(id, body) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const active = body.active === undefined ? true : Boolean(body.active);
  if (!name || name.length > 150) return { error: 'Please enter a name (up to 150 characters).' };
  if (!USERNAME.test(username)) return { error: 'Username: 3 to 50 letters, numbers, dots, dashes or underscores, no spaces.' };
  if (!id && password.length < MIN_PASSWORD) return { error: `Please set a password of at least ${MIN_PASSWORD} characters.` };
  if (password && password.length < MIN_PASSWORD) return { error: `The new password needs at least ${MIN_PASSWORD} characters.` };
  if (password.length > 100) return { error: 'That password is too long.' };

  if (id) {
    const { rows: [current] } = await pool.query('SELECT role FROM admin_users WHERE id = $1', [id]);
    if (!current) return { error: 'That login no longer exists.' };
    if (current.role === 'owner') return { error: "The owner's login is set on the server (ADMIN_USERNAME / ADMIN_PASSWORD), not here." };
  }
  try {
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const { rows: [user] } = id
      ? await pool.query(
        `UPDATE admin_users SET name = $2, username = $3, active = $4, password_hash = COALESCE($5, password_hash)
         WHERE id = $1 AND role = 'manager' RETURNING id, name, username, role, active`,
        [id, name, username, active, hash]
      )
      : await pool.query(
        `INSERT INTO admin_users (name, username, password_hash, role, active)
         VALUES ($1, $2, $3, 'manager', $4) RETURNING id, name, username, role, active`,
        [name, username, hash, active]
      );
    // A new password or switching someone off signs them out straight away.
    if (id && (hash || !active)) await endSessions(id);
    return { user };
  } catch (err) {
    if (err.code === '23505') return { error: 'That username is already taken.' };
    throw err;
  }
}

async function remove(id) {
  const { rows } = await pool.query("DELETE FROM admin_users WHERE id = $1 AND role = 'manager' RETURNING id", [id]);
  if (!rows.length) return { error: "That login can't be deleted." };
  await endSessions(id);
  return { ok: true };
}

module.exports = {
  list, save, remove, endSessions,
};
