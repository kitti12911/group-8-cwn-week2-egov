'use strict';
// /api/test/* (CONTRACT §8) — only when TEST_MODE=1; otherwise every /api/test/* → 404.
// This file: reset + clock. Other blocks add their hooks on ctx.testRouter:
//   POST /api/test/payments/:ref/pay  (B06)   POST /api/test/documents/:docNo/tamper  (B08)
const express = require('express');
const { TEST_MODE } = require('./lib/config');
const clock = require('./lib/clock');
const time = require('./lib/time');
const { sendError } = require('./lib/errors');
const { resetAll } = require('./reset');

function createTestRouter(ctx) {
  const r = express.Router();

  r.post('/reset', (req, res) => {
    const now = resetAll(ctx);
    // the caller's cookie is dead too: clear it
    res.append('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true, now });
  });

  r.get('/clock', (req, res) => res.json({ now: clock.nowIso() }));

  r.put('/clock', (req, res) => {
    const d = time.parseIsoStrict(req.body && req.body.now);
    if (!d) return sendError(res, 'INVALID_TIME');
    res.json({ now: clock.set(d) });
  });

  return r;
}

/** mount at /api/test: real router when TEST_MODE, else 404 for everything */
function mountTestHooks(app, testRouter) {
  if (TEST_MODE) {
    app.use('/api/test', testRouter);
    app.use('/api/test', (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found' }));
  } else {
    app.use('/api/test', (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found' }));
  }
}

module.exports = { createTestRouter, mountTestHooks };
