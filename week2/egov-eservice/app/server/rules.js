'use strict';
// Block B03 · business rules (pure functions, no DB writes, no clock reads).
// Fee: BR-04 BR-05 (DECISIONS §3) · SLA working days: BR-12 BR-13 (DECISIONS §0 §8 §18)
// Levels: BR-14 · queue order: BR-16 · on-time: DECISIONS §18 · FR-19
// BUG_MODE: B01 (SV-03 area 101 → ฿1,000) · B03 (holidays table ignored, weekends only)
//           B04 (no SLA pause during NEED_FIX). Each bug touches only its own rule.
//
// Usage (in a feature module):
//   const rules = require('./rules');
//   const fee  = rules.computeFee(serviceRow, { qty, areaSqm });          // throws AppError INVALID_QTY / INVALID_AREA / AREA_TOO_LARGE
//   const hol  = rules.loadHolidays(ctx.db);                               // Set of 'YYYY-MM-DD'
//   const due  = rules.computeDueAt(ctx.clock.now(), serviceRow.sla, hol); // "2026-12-04T16:30:00+07:00"
//   const due2 = rules.extendDueOnResubmit(c.due_at, c.returned_at, ctx.clock.now(), rules.loadHolidays(ctx.db));
//   const lvl  = rules.slaLevel({ status, dueAt }, ctx.clock.now(), hol);  // 'normal'|'near'|'overdue'|'paused'|'closed'|null
// Every function takes an optional last arg `opts = { bugMode }` (function id → bool); default = lib/bugs (BUG_MODE env).

const time = require('./lib/time');
const { AppError } = require('./lib/errors');
const { bugMode: envBugMode } = require('./lib/bugs');

const CUTOFF_H = 16; // 16:30:00 cut-off and due time (A-03)
const CUTOFF_M = 30;

const DEFAULT_SERVICES = {
  'SV-01': { id: 'SV-01', fee: 20, fee_per_sqm: null, sla: 3 },
  'SV-02': { id: 'SV-02', fee: 500, fee_per_sqm: null, sla: 10 },
  'SV-03': { id: 'SV-03', fee: 1000, fee_per_sqm: 10, sla: 15 },
};
const QTY_MIN = 1, QTY_MAX = 5;
const AREA_MIN = 1, AREA_MAX = 500, AREA_BASE = 100;

const CLOSED_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']); // A-33: level "ปิดแล้ว"
const DONE_STATUSES = new Set(['COMPLETED', 'REJECTED']); // SLA stops (closed_at) · on-time counted
const NO_SLA_STATUSES = new Set(['DRAFT', 'PENDING_PAYMENT']);

const LEVEL_LABELS = {
  normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว',
};

const isBug = (opts, id) => ((opts && opts.bugMode) || envBugMode)(id);

// ── helpers ─────────────────────────────────────────────────────────
/** strict integer from number or numeric string ("101", 101). Otherwise null. */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

function svc(service) {
  if (typeof service === 'string') return DEFAULT_SERVICES[service] || { id: service };
  const base = DEFAULT_SERVICES[service && service.id] || {};
  const s = { ...base, ...service };
  if (s.fee == null) s.fee = base.fee;
  if (s.fee_per_sqm == null) s.fee_per_sqm = s.feePerSqm != null ? s.feePerSqm : base.fee_per_sqm;
  return s;
}

// ── fee (BR-04 BR-05) ───────────────────────────────────────────────
/** SV-01: fee × qty, qty integer 1–5 (BR-04) */
function feeSv01(qty, perCopy = 20) {
  const q = toInt(qty);
  if (q == null || q < QTY_MIN || q > QTY_MAX) throw new AppError('INVALID_QTY');
  return perCopy * q;
}

/** SV-03: area integer 1–500 · 1–100 → base · 101–500 → base + perSqm × (area − 100) (BR-05) */
function feeSv03(areaSqm, base = 1000, perSqm = 10, opts) {
  const a = toInt(areaSqm);
  if (a == null || a < AREA_MIN) throw new AppError('INVALID_AREA');
  if (a > AREA_MAX) throw new AppError('AREA_TOO_LARGE');
  // B01: uses "> 101" instead of "≥ 101" → area 101 billed as base (102 still correct)
  const surcharged = isBug(opts, 'B01') ? a > AREA_BASE + 1 : a > AREA_BASE;
  return surcharged ? base + perSqm * (a - AREA_BASE) : base;
}

/**
 * Fee in integer baht for a service row (services table: id, fee, fee_per_sqm) or id string.
 * input: { qty } for SV-01 · { areaSqm } (or area_sqm) for SV-03 · SV-02 flat.
 * Throws AppError INVALID_QTY | INVALID_AREA | AREA_TOO_LARGE (HTTP 400).
 */
function computeFee(service, input = {}, opts) {
  const s = svc(service);
  if (s.id === 'SV-01') return feeSv01(input.qty, s.fee);
  if (s.id === 'SV-03') {
    const area = input.areaSqm !== undefined ? input.areaSqm : input.area_sqm;
    return feeSv03(area, s.fee, s.fee_per_sqm, opts);
  }
  return s.fee; // SV-02 and any other flat-fee service
}

/** Non-throwing variant for UI: { fee, code, message } (fee null on error). */
function feeResult(service, input = {}, opts) {
  try {
    return { fee: computeFee(service, input, opts), code: null, message: null };
  } catch (e) {
    if (e instanceof AppError) return { fee: null, code: e.code, message: e.message };
    throw e;
  }
}

// ── working days (BR-12, DECISIONS §0) ──────────────────────────────
/** holidays: Set / array of 'YYYY-MM-DD' or rows {date} / null → Set */
function holidaySet(holidays) {
  if (holidays instanceof Set) return holidays;
  const out = new Set();
  for (const h of holidays || []) out.add(typeof h === 'string' ? h : h && h.date);
  return out;
}

/** read the holidays table (current table — callers use it at payment / resubmit time, A-42) */
function loadHolidays(db) {
  return new Set(db.prepare('SELECT date FROM holidays').all().map((r) => r.date));
}

/** 'YYYY-MM-DD' → { y, m, d, dow } */
function keyParts(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { y, m, d, dow: dt.getUTCDay() };
}

function shiftKey(key, days) {
  const { y, m, d } = keyParts(key);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${time.pad(dt.getUTCMonth() + 1)}-${time.pad(dt.getUTCDate())}`;
}

/** Date | ISO | 'YYYY-MM-DD' → Bangkok calendar key */
function dayKey(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return time.dateKey(time.toDate(v));
}

/** Mon–Fri not in the holiday table. B03: holiday table ignored (weekends only). */
function isWorkingDay(v, holidays, opts) {
  const key = dayKey(v);
  const { dow } = keyParts(key);
  if (dow === 0 || dow === 6) return false;
  if (isBug(opts, 'B03')) return true;
  return !holidaySet(holidays).has(key);
}

function nextWorkingDay(v, holidays, opts) {
  const set = holidaySet(holidays);
  let k = shiftKey(dayKey(v), 1);
  while (!isWorkingDay(k, set, opts)) k = shiftKey(k, 1);
  return k;
}

/** n-th working day after the given day (n ≥ 0; n = 0 → same key) */
function addWorkingDays(v, n, holidays, opts) {
  const set = holidaySet(holidays);
  let k = dayKey(v);
  for (let i = 0; i < n; i++) k = nextWorkingDay(k, set, opts);
  return k;
}

/** number of working days in (from, to] by calendar date (0 if to ≤ from) */
function countWorkingDays(fromExclusive, toInclusive, holidays, opts) {
  const set = holidaySet(holidays);
  const end = dayKey(toInclusive);
  let k = dayKey(fromExclusive);
  let n = 0;
  while (k < end) {
    k = shiftKey(k, 1);
    if (isWorkingDay(k, set, opts)) n++;
  }
  return n;
}

/** D0: paid day if working day and before 16:30:00, else next working day (BR-12) */
function startDay(paidAt, holidays, opts) {
  const set = holidaySet(holidays);
  const p = time.parts(time.toDate(paidAt));
  const key = dayKey(paidAt);
  const beforeCutoff = p.hh < CUTOFF_H || (p.hh === CUTOFF_H && p.mm < CUTOFF_M);
  if (isWorkingDay(key, set, opts) && beforeCutoff) return key;
  return nextWorkingDay(key, set, opts);
}

/** 'YYYY-MM-DD' → "YYYY-MM-DDT16:30:00+07:00" */
function dueIsoOf(key) {
  return `${key}T${time.pad(CUTOFF_H)}:${time.pad(CUTOFF_M)}:00+07:00`;
}

/** Due = N-th working day after D0 at 16:30 (BR-12). Computed once at payment (A-42). */
function computeDueAt(paidAt, slaDays, holidays, opts) {
  const set = holidaySet(holidays);
  const d0 = startDay(paidAt, set, opts);
  return dueIsoOf(addWorkingDays(d0, Number(slaDays), set, opts));
}

/** SLA days paused = working days in (returnedAt date, resubmittedAt date] (BR-13). B04 → 0. */
function pausedWorkingDays(returnedAt, resubmittedAt, holidays, opts) {
  if (isBug(opts, 'B04')) return 0;
  return countWorkingDays(returnedAt, resubmittedAt, holidays, opts);
}

/** New due on resubmit = old due + paused working days, still 16:30 (BR-13; holidays as of resubmit). */
function extendDueOnResubmit(dueAt, returnedAt, resubmittedAt, holidays, opts) {
  const set = holidaySet(holidays);
  const n = pausedWorkingDays(returnedAt, resubmittedAt, set, opts);
  if (n === 0) return time.toIso(time.toDate(dueAt));
  return dueIsoOf(addWorkingDays(dayKey(dueAt), n, set, opts));
}

// ── levels (BR-14) ──────────────────────────────────────────────────
/** working days after today up to the due date (due day included) */
// B03 is scoped to the due-date calculation (computeDueAt / extendDueOnResubmit) only: the level counter stays
// holiday-aware so the bug does not leak into SLA levels / notifications (BUGS.md rule 1; B14 integration).
function daysRemaining(now, dueAt, holidays, opts) {
  const noB03 = { bugMode: (id) => id !== 'B03' && isBug(opts, id) };
  return countWorkingDays(now, dueAt, holidays, noB03);
}

/**
 * c: { status, dueAt } (or due_at). Returns 'closed' (COMPLETED/REJECTED/CANCELLED) · 'paused' (NEED_FIX)
 * · null (no due yet) · 'overdue' (now > due) · 'near' (remaining ≤ 1) · 'normal' (remaining ≥ 2).
 */
function slaLevel(c, now, holidays, opts) {
  const status = c && c.status;
  if (CLOSED_STATUSES.has(status)) return 'closed';
  if (status === 'NEED_FIX') return 'paused';
  const due = c && (c.dueAt !== undefined ? c.dueAt : c.due_at);
  if (!due || NO_SLA_STATUSES.has(status)) return null;
  const nowD = time.toDate(now);
  const dueD = time.toDate(due);
  if (nowD.getTime() > dueD.getTime()) return 'overdue';
  return daysRemaining(nowD, dueD, holidays, opts) <= 1 ? 'near' : 'normal';
}

const levelLabel = (level) => LEVEL_LABELS[level] || '';

/** on time ⇔ closed_at ≤ due (DECISIONS §18; 16:30:00 counts as on time) */
function isOnTime(closedAt, dueAt) {
  if (!closedAt || !dueAt) return false;
  return time.toDate(closedAt).getTime() <= time.toDate(dueAt).getTime();
}

// ── queue order (BR-16) ─────────────────────────────────────────────
/** earliest due first · tie → case number ascending · missing due last */
function compareQueue(a, b) {
  const da = a.dueAt !== undefined ? a.dueAt : a.due_at;
  const db = b.dueAt !== undefined ? b.dueAt : b.due_at;
  const ta = da ? time.toDate(da).getTime() : Infinity;
  const tb = db ? time.toDate(db).getTime() : Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ca = String(a.caseNo !== undefined ? a.caseNo : a.case_no || '');
  const cb = String(b.caseNo !== undefined ? b.caseNo : b.case_no || '');
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

module.exports = {
  // constants
  DEFAULT_SERVICES, QTY_MIN, QTY_MAX, AREA_MIN, AREA_MAX, AREA_BASE,
  CLOSED_STATUSES, DONE_STATUSES, LEVEL_LABELS,
  // fee
  computeFee, feeResult, feeSv01, feeSv03,
  // working days / SLA
  holidaySet, loadHolidays, dayKey, isWorkingDay, nextWorkingDay, addWorkingDays, countWorkingDays,
  startDay, computeDueAt, pausedWorkingDays, extendDueOnResubmit, dueIsoOf,
  // levels
  daysRemaining, slaLevel, levelLabel, isOnTime,
  // queue
  compareQueue,
};
