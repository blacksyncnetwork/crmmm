// Auth: scrypt password hashing + HMAC-SHA256 JWTs.
// Pure node:crypto — no native or third-party dependencies.

const crypto = require('crypto');
const db = require('./db');

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function secret() {
  return process.env.CRM_JWT_SECRET || db.secret;
}

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Express middleware: requires Bearer token, attaches req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  const user = payload && db.get('users', payload.sub);
  if (!user || user.disabled) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// Resolves the active sub-account from the X-Location-Id header and checks
// the user can access it. Agency admins can access every location.
function requireLocation(req, res, next) {
  const locationId = req.headers['x-location-id'] || req.query.locationId;
  const location = locationId && db.get('locations', locationId);
  if (!location) return res.status(400).json({ error: 'missing or unknown X-Location-Id header' });
  const allowed = req.user.role === 'agency_admin' || (req.user.locationIds || []).includes(location.id);
  if (!allowed) return res.status(403).json({ error: 'no access to this sub-account' });
  req.location = location;
  next();
}

function requireAgencyAdmin(req, res, next) {
  if (req.user.role !== 'agency_admin') return res.status(403).json({ error: 'agency admin only' });
  next();
}

function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken,
  requireAuth, requireLocation, requireAgencyAdmin, publicUser
};
