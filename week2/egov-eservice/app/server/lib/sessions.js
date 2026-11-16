'use strict';
// Cookie session stored in DB table `sessions` (so /api/test/reset logs everyone out).
// Session data is a SNAPSHOT taken at login (role change by admin applies at next login, CONTRACT §6.5).
//   sessions.create(res, { type:'staff', id, username, name, role, dept })
//   sessions.create(res, { type:'citizen', id, username:'<citizenId>', name, role:'citizen', dept:'', scope:'register' })
//      scope 'register' = verified by OTP but not yet registered → only /register + /api/auth/register
//   sessions.destroy(req, res)
// Middleware sets req.session = {sid, ...data} | null and req.user = data (only when scope !== 'register').
const { db } = require('../db');
const clock = require('./clock');
const { token } = require('./crypto');

const COOKIE = 'sid';

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, value, maxAge) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge === 0) parts.push('Max-Age=0');
  res.append('Set-Cookie', parts.join('; '));
}

function create(res, data) {
  const sid = token(24);
  db.prepare('INSERT INTO sessions(sid, data, created_at) VALUES (?, ?, ?)').run(sid, JSON.stringify(data), clock.nowIso());
  setCookie(res, sid);
  return sid;
}

function update(req, data) {
  if (!req.session) return;
  const merged = { ...req.session, ...data };
  delete merged.sid;
  db.prepare('UPDATE sessions SET data = ? WHERE sid = ?').run(JSON.stringify(merged), req.session.sid);
  req.session = { sid: req.session.sid, ...merged };
  req.user = merged.scope === 'register' ? null : merged;
}

function destroy(req, res) {
  if (req.session) db.prepare('DELETE FROM sessions WHERE sid = ?').run(req.session.sid);
  setCookie(res, '', 0);
  req.session = null;
  req.user = null;
}

function middleware(req, res, next) {
  req.session = null;
  req.user = null;
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) {
    const row = db.prepare('SELECT data FROM sessions WHERE sid = ?').get(sid);
    if (row) {
      const data = JSON.parse(row.data);
      req.session = { sid, ...data };
      if (data.scope !== 'register') req.user = data;
    }
  }
  res.locals.user = req.user;
  next();
}

module.exports = { create, update, destroy, middleware, parseCookies, COOKIE };
