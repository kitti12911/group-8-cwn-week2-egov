'use strict';
// Time helpers. All business time is Asia/Bangkok (+07:00, no DST).
// Storage format in DB = ISO string with +07:00, e.g. "2026-12-04T16:30:00+07:00"
// (same offset everywhere → string compare == time compare).
// NEVER use Date.now()/new Date() for business rules: use clock.now() (lib/clock.js).

const OFFSET_MS = 7 * 3600 * 1000;
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const pad = (n, w = 2) => String(n).padStart(w, '0');

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    // "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" without offset → treat as Bangkok local
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - OFFSET_MS);
    return new Date(v);
  }
  throw new TypeError('bad time value: ' + v);
}

/** Strict ISO parse; requires an offset (or Z). Returns Date or null. */
function parseIsoStrict(s) {
  if (typeof s !== 'string' || !ISO_WITH_OFFSET.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Bangkok wall-clock parts. dow: 0=Sun..6=Sat */
function parts(v) {
  const d = new Date(toDate(v).getTime() + OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(), dow: d.getUTCDay(),
  };
}

/** Date → "2026-12-04T16:30:00+07:00" */
function toIso(v) {
  if (v == null) return null;
  const p = parts(v);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}+07:00`;
}

/** Date → "2026-12-04" (Bangkok calendar date) */
function dateKey(v) {
  const p = parts(v);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Date → "2026-12" */
function monthKey(v) {
  const p = parts(v);
  return `${p.y}-${pad(p.m)}`;
}

/** Bangkok wall clock → Date. at(2026,12,4,16,30) */
function at(y, m, d, hh = 0, mm = 0, ss = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - OFFSET_MS);
}

/** Buddhist-era year of a time (Bangkok) */
function beYear(v) {
  return parts(v).y + 543;
}

/** "4 ธ.ค. 2569 16:30" (CONTRACT §0.2) */
function thaiDateTime(v) {
  if (v == null) return '';
  const p = parts(v);
  return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543} ${pad(p.hh)}:${pad(p.mm)}`;
}

/** "4 ธ.ค. 2569" */
function thaiDate(v) {
  if (v == null) return '';
  const p = parts(v);
  return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543}`;
}

/** 1010 → "฿1,010" (integer baht, A-04) */
function baht(n) {
  if (n == null || n === '') return '';
  return '฿' + Math.round(Number(n)).toLocaleString('en-US');
}

/** add ms / minutes / hours / days (calendar) */
const addMs = (v, ms) => new Date(toDate(v).getTime() + ms);
const addMinutes = (v, n) => addMs(v, n * 60000);
const addHours = (v, n) => addMs(v, n * 3600000);
const addDays = (v, n) => addMs(v, n * 86400000);

module.exports = {
  OFFSET_MS, TH_MONTHS, toDate, parseIsoStrict, parts, toIso, dateKey, monthKey, at, beYear,
  thaiDateTime, thaiDate, baht, addMs, addMinutes, addHours, addDays, pad,
};
