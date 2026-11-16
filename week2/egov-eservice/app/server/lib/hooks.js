'use strict';
// Cross-module hook registry.
//   onRequest(fn)  fn(req) runs (sync) before EVERY HTTP request except /api/test/* (CONTRACT §0.7):
//                  SLA notifications (B09), auto-cancel after fix window (B06/B07) ...
//   onReset(fn)    fn() runs after /api/test/reset wiped + seeded the DB (clear in-memory caches).
const requestHooks = [];
const resetHooks = [];

module.exports = {
  onRequest(fn) { requestHooks.push(fn); },
  onReset(fn) { resetHooks.push(fn); },
  runRequest(req) { for (const fn of requestHooks) fn(req); },
  runReset() { for (const fn of resetHooks) fn(); },
};
