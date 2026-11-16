'use strict';
// Express app assembly. Feature blocks plug in as modules:
//   server/<name>.js  →  module.exports = function register(app, ctx) { app.get(...); ctx.testRouter.post(...); }
// Modules that don't exist yet are skipped, so the skeleton always boots.
const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('./lib/config');
const { db, nextNumber, setCounter } = require('./db');
const clock = require('./lib/clock');
const time = require('./lib/time');
const { bugMode } = require('./lib/bugs');
const audit = require('./lib/audit');
const errors = require('./lib/errors');
const mask = require('./lib/mask');
const crypto = require('./lib/crypto');
const guard = require('./lib/guard');
const sessions = require('./lib/sessions');
const hooks = require('./lib/hooks');
const upload = require('./lib/upload');
const labels = require('./lib/labels');
const view = require('./lib/view');
const { createTestRouter, mountTestHooks } = require('./test-hooks');

// Load order matters only for onRequest hooks (payments/officer auto-cancel before notifications).
const MODULES = ['auth', 'citizen-apply', 'payments', 'officer', 'documents', 'notifications', 'dashboard', 'admin-audit'];

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.ROOT, 'views'));
  app.set('etag', false);

  const ctx = {
    app, config, db, nextNumber, setCounter, clock, time, bugMode, audit, errors, mask, crypto,
    guard, sessions, hooks, upload, labels, view, testRouter: null,
  };
  ctx.testRouter = createTestRouter(ctx);

  app.use('/static', express.static(path.join(config.ROOT, 'public'), { maxAge: 0 }));
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: config.BODY_LIMIT }));
  app.use((err, req, res, next) => { // body-parser errors → JSON
    if (err && err.type === 'entity.too.large') return errors.sendError(res, 'FILE_TOO_LARGE');
    if (err && err.type === 'entity.parse.failed') return errors.sendError(res, 'BAD_REQUEST');
    next(err);
  });

  app.use(sessions.middleware);

  // CONTRACT §0.7: every request except /api/test/* re-evaluates SLA notifications + auto-cancel
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/test/') && req.path !== '/api/test') {
      try { hooks.runRequest(req); } catch (e) { console.error('[onRequest]', e.message); }
    }
    next();
  });

  app.use(view.locals);

  // FR-28 / NFR-06: exact body, no auth, independent of TEST_MODE
  app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

  mountTestHooks(app, ctx.testRouter);

  app.get('/', (req, res) => {
    if (req.user) return res.redirect(guard.landingFor(req.user));
    if (req.session && req.session.scope === 'register') return res.redirect('/register');
    return res.redirect('/login');
  });

  // plain-form logout used by header `logout-btn` (API variant POST /api/auth/logout lives in auth.js)
  app.post('/logout', (req, res) => { sessions.destroy(req, res); res.redirect('/login'); });

  for (const name of MODULES) {
    const file = path.join(__dirname, name + '.js');
    if (!fs.existsSync(file)) continue;
    const mod = require(file);
    const register = typeof mod === 'function' ? mod : mod.register;
    if (typeof register === 'function') register(app, ctx);
  }

  // 404
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found' });
    return res.status(404).render('error', { title: 'ไม่พบหน้า', message: 'ไม่พบหน้าที่ต้องการ' });
  });

  // errors: AppError → {"code","message"}; pages render error view
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const e = err instanceof errors.AppError ? err : null;
    if (!e) console.error(err);
    const status = e ? e.status : 500;
    if (req.path.startsWith('/api/')) {
      return res.status(status).json(e ? e.toJSON() : errors.errorBody('INTERNAL'));
    }
    if (status === 403) return guard.renderForbidden(req, res);
    if (e && e.code === 'NOT_FOUND') return guard.renderNotFound(req, res);
    return res.status(status).render('error', { title: 'ข้อผิดพลาด', message: e ? e.message : errors.messageOf('INTERNAL') });
  });

  return { app, ctx };
}

module.exports = { createApp };
