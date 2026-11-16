'use strict';
// RBAC guards (CONTRACT §1). Pages vs API differ:
//   page, not logged in      → 302 /login   (register-scope session → 302 /register)
//   page, wrong role         → 403 + views/forbidden.ejs (testid forbidden-msg)
//   API,  not logged in      → 401 {"code":"UNAUTHENTICATED"}
//   API,  wrong role         → 403 {"code":"FORBIDDEN"}
// usage: app.get('/officer/queue', page('officer','head'), handler)
//        app.post('/api/drafts', api('citizen'), handler)
const { sendError } = require('./errors');

const LANDING = {
  citizen: '/citizen', officer: '/officer/queue', head: '/head/approvals',
  executive: '/dashboard', auditor: '/audit', admin: '/admin/services',
};

function landingFor(user) {
  return user ? LANDING[user.role] || '/login' : '/login';
}

function renderForbidden(req, res) {
  return res.status(403).render('forbidden', { title: 'ไม่มีสิทธิ์เข้าถึง' });
}

function renderNotFound(req, res) {
  return res.status(404).render('not-found', { title: 'ไม่พบคำขอ' });
}

/** page guard; no roles = any logged-in user */
function page(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.session && req.session.scope === 'register') return res.redirect('/register');
      return res.redirect('/login');
    }
    if (roles.length && !roles.includes(req.user.role)) return renderForbidden(req, res);
    next();
  };
}

/** API guard; no roles = any logged-in user */
function api(...roles) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 'UNAUTHENTICATED');
    if (roles.length && !roles.includes(req.user.role)) return sendError(res, 'FORBIDDEN');
    next();
  };
}

module.exports = { page, api, landingFor, renderForbidden, renderNotFound, LANDING };
