'use strict';
// Reset = wipe every table (sessions, OTP state, locks, notifications, audit, uploads incl.)
// → seed TEST-DATA (server/seed.js, block B02) → clock back to DEFAULT_NOW → VACUUM.
// Deterministic: same seed + same clock ⇒ same DB every time (NFR-09).
const fs = require('fs');
const path = require('path');
const { db, wipe } = require('./db');
const clock = require('./lib/clock');
const hooks = require('./lib/hooks');

function loadSeed() {
  const p = path.join(__dirname, 'seed.js');
  if (!fs.existsSync(p)) return null;
  const m = require(p);
  return typeof m === 'function' ? m : m.seed;
}

function resetAll(ctx) {
  clock.reset();
  const seed = loadSeed();
  db.transaction(() => {
    wipe();
    if (seed) seed(ctx);
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('seeded', '1')").run();
  })();
  db.exec('VACUUM'); // drop freed pages (no leftover data in the file)
  hooks.runReset();
  return clock.nowIso();
}

function isSeeded() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  return !!(r && r.value === '1');
}

module.exports = { resetAll, isSeeded };
