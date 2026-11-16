'use strict';
// Test clock (CONTRACT §8). Business rules must call clock.now() — never Date.now().
// TEST_MODE=1: clock is FROZEN; starts at DEFAULT_NOW, changed by PUT /api/test/clock, reset by /api/test/reset.
// Not TEST_MODE: real time.
const { TEST_MODE, DEFAULT_NOW } = require('./config');
const time = require('./time');

let frozen = TEST_MODE ? time.toDate(DEFAULT_NOW) : null;

module.exports = {
  /** current time as Date */
  now() {
    return frozen ? new Date(frozen.getTime()) : new Date();
  },
  /** current time as "YYYY-MM-DDTHH:MM:SS+07:00" */
  nowIso() {
    return time.toIso(this.now());
  },
  /** freeze clock at a Date or ISO string (validated by caller) */
  set(v) {
    frozen = time.toDate(v);
    return this.nowIso();
  },
  reset() {
    frozen = TEST_MODE ? time.toDate(DEFAULT_NOW) : null;
    return this.nowIso();
  },
  isFrozen() {
    return !!frozen;
  },
};
