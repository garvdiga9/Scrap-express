// Slows down password guessing on the admin login. Only failed attempts count,
// and a successful login clears them for that connection.
//  - per connection (IP): 5 wrong passwords in 15 minutes → locked for the
//    rest of that window.
//  - per username: 20 in 15 minutes from anywhere, so guesses spread over
//    many connections are capped too, while the real admin (on a different
//    connection) is rarely locked out by someone else's guessing.
// Kept in memory: the site runs as one server, and a restart only resets it.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_USERNAME = 20;
const MAX_KEYS = 10000;

const failures = new Map(); // key → [timestamps]

function recent(key, now) {
  const times = (failures.get(key) || []).filter((t) => t > now - WINDOW_MS);
  if (times.length) failures.set(key, times); else failures.delete(key);
  return times;
}

const keysFor = (ip, username) => [`ip:${ip}`, `user:${String(username || '').trim().toLowerCase()}`];

// Seconds until another attempt is allowed, or 0 if it is allowed now.
function retryAfter(ip, username, now = Date.now()) {
  const [ipKey, userKey] = keysFor(ip, username);
  const waits = [[ipKey, MAX_PER_IP], [userKey, MAX_PER_USERNAME]].map(([key, max]) => {
    const times = recent(key, now);
    return times.length >= max ? times[times.length - max] + WINDOW_MS - now : 0;
  });
  return Math.ceil(Math.max(...waits) / 1000);
}

function recordFailure(ip, username, now = Date.now()) {
  if (failures.size > MAX_KEYS) failures.clear();
  keysFor(ip, username).forEach((key) => failures.set(key, [...recent(key, now), now]));
}

function recordSuccess(ip) {
  failures.delete(`ip:${ip}`);
}

module.exports = {
  retryAfter, recordFailure, recordSuccess, WINDOW_MS, MAX_PER_IP, MAX_PER_USERNAME,
};
