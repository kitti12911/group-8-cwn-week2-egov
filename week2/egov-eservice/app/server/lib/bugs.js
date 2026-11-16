'use strict';
// BUG_MODE=B03,B07 → bugMode('B03') === true. Unset → always false (web 100% correct).
const { BUG_MODE } = require('./config');

const active = new Set(
  String(BUG_MODE).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
);

function bugMode(id) {
  return active.has(String(id).toUpperCase());
}
bugMode.list = () => [...active];

module.exports = { bugMode };
