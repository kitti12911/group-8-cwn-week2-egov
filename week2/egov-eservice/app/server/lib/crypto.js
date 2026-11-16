'use strict';
// PII at rest (NFR-04, DECISIONS §11): idNo + mobile stored AES-256-GCM encrypted.
// Deterministic IV (HMAC of plaintext) → same seed ⇒ same DB bytes on every reset.
// Lookup by idNo uses hashId() (base64url HMAC → never contains a 13-digit run).
// Output alphabet is base64url so DB never contains plain 13-digit / 10-digit numbers.
const crypto = require('crypto');
const { PII_KEY, SIGN_KEY } = require('./config');

const KEY = crypto.createHash('sha256').update(PII_KEY).digest(); // 32 bytes
const HKEY = crypto.createHash('sha256').update('hash:' + PII_KEY).digest();

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const s = String(plain);
  const iv = crypto.createHmac('sha256', HKEY).update('iv:' + s).digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'v1.' + Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decrypt(token) {
  if (!token) return null;
  const raw = Buffer.from(String(token).replace(/^v1\./, ''), 'base64url');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** stable lookup key for a citizen ID (not reversible, no digit runs) */
function hashId(idNo) {
  return crypto.createHmac('sha256', HKEY).update('id:' + String(idNo)).digest('base64url');
}

/** deterministic password hash (scrypt, salt derived from username) */
function hashPassword(username, password) {
  const salt = crypto.createHash('sha256').update('salt:' + username).digest();
  return 's1.' + crypto.scryptSync(String(password), salt, 32).toString('base64url');
}
function verifyPassword(username, password, stored) {
  const a = Buffer.from(hashPassword(username, password));
  const b = Buffer.from(String(stored || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** HMAC-SHA256 (hex) with test signing key — used for digital documents (CONTRACT §3) */
function sign(fields) {
  return crypto.createHmac('sha256', SIGN_KEY).update(fields.map((f) => (f == null ? '' : String(f))).join('|')).digest('hex');
}

/** random token (sessions) */
function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { encrypt, decrypt, hashId, hashPassword, verifyPassword, sign, token };
