// Dashboard sessions carry who is signed in: adminId, adminName and adminRole
// ('owner' or 'manager', see lib/team.js). Sessions from before there were
// several logins only ever belonged to the owner.
const roleOf = (req) => req.session.adminRole || 'owner';

// Managers can't delete anything (turning off their own notifications aside).
const MANAGER_CAN_DELETE = new Set(['/push']);

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.method === 'DELETE' && roleOf(req) !== 'owner' && !MANAGER_CAN_DELETE.has(req.path)) {
    return res.status(403).json({ error: 'Only the owner can delete things. Ask the owner to do it.' });
  }
  return next();
}

function requireOwner(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (roleOf(req) !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can do this.' });
  }
  return next();
}

module.exports = { requireAdmin, requireOwner, roleOf };
