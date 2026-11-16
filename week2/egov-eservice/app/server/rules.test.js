'use strict';
// Unit tests for server/rules.js (block B03) · run: node --test server/rules.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./rules');

const HOL = ['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']; // DECISIONS §0 seed
const none = { bugMode: () => false };
const bug = (...ids) => ({ bugMode: (id) => ids.includes(id) });
const T = (s) => `${s}+07:00`;

const errCode = (fn) => {
  try { fn(); } catch (e) { return e.code; }
  return null;
};

// ── BR-04 ───────────────────────────────────────────────────────────
test('BR-04 SV-01 fee ฿20 × qty 1–5', () => {
  for (const [q, fee] of [[1, 20], [2, 40], [3, 60], [4, 80], [5, 100], ['3', 60]]) {
    assert.equal(r.computeFee('SV-01', { qty: q }, none), fee, `qty ${q}`);
  }
  for (const q of [0, 6, -1, 1.5, '', null, undefined, 'abc']) {
    assert.equal(errCode(() => r.computeFee('SV-01', { qty: q }, none)), 'INVALID_QTY', `qty ${q}`);
  }
  const res = r.feeResult('SV-01', { qty: 6 }, none);
  assert.deepEqual(res, { fee: null, code: 'INVALID_QTY', message: 'จำนวนฉบับต้อง 1–5 ฉบับ' });
  // admin-edited per-copy fee from services row
  assert.equal(r.computeFee({ id: 'SV-01', fee: 30 }, { qty: 2 }, none), 60);
});

// ── BR-05 ───────────────────────────────────────────────────────────
test('BR-05 SV-03 area fee + SV-02 flat', () => {
  const rows = [[1, 1000], [100, 1000], [101, 1010], [102, 1020], [250, 2500], [300, 3000], [499, 4990], [500, 5000], ['101', 1010]];
  for (const [a, fee] of rows) assert.equal(r.computeFee('SV-03', { areaSqm: a }, none), fee, `area ${a}`);
  assert.equal(r.computeFee({ id: 'SV-03', fee: 1000, fee_per_sqm: 10 }, { area_sqm: 101 }, none), 1010);
  for (const a of [0, -1, 10.5, '', null, undefined]) {
    assert.equal(errCode(() => r.computeFee('SV-03', { areaSqm: a }, none)), 'INVALID_AREA', `area ${a}`);
  }
  assert.equal(errCode(() => r.computeFee('SV-03', { areaSqm: 501 }, none)), 'AREA_TOO_LARGE');
  assert.equal(r.feeResult('SV-03', { areaSqm: 501 }, none).message, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน');
  assert.equal(r.feeResult('SV-03', { areaSqm: 0 }, none).message, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.');
  assert.equal(r.computeFee('SV-02', {}, none), 500);
  assert.equal(r.computeFee({ id: 'SV-02', fee: 600 }, {}, none), 600);
});

test('B01 changes only area 101', () => {
  const b = bug('B01');
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }, b), 1000);
  for (const [a, fee] of [[1, 1000], [100, 1000], [102, 1020], [500, 5000]]) {
    assert.equal(r.computeFee('SV-03', { areaSqm: a }, b), fee);
  }
  assert.equal(errCode(() => r.computeFee('SV-03', { areaSqm: 501 }, b)), 'AREA_TOO_LARGE');
  assert.equal(errCode(() => r.computeFee('SV-03', { areaSqm: 0 }, b)), 'INVALID_AREA');
  assert.equal(r.computeFee('SV-01', { qty: 5 }, b), 100);
  assert.equal(r.computeDueAt(T('2026-12-01T16:30:00'), 3, HOL, b), T('2026-12-08T16:30:00')); // SLA untouched
});

// ── BR-12 / TEST-PLAN SLA-01 ────────────────────────────────────────
const SLA01 = [
  // row, paidAt, sla, expected, expected with B03 (BUGS.md)
  ['a', '2026-12-01T09:00:00', 3, '2026-12-04', '2026-12-04'],
  ['b', '2026-12-01T16:29:00', 3, '2026-12-04', '2026-12-04'],
  ['b2', '2026-12-01T16:29:59', 3, '2026-12-04', '2026-12-04'],
  ['c', '2026-12-01T16:30:00', 3, '2026-12-08', '2026-12-07'],
  ['d', '2026-12-04T10:00:00', 3, '2026-12-11', '2026-12-09'],
  ['e', '2026-12-05T10:00:00', 3, '2026-12-14', '2026-12-10'],
  ['f', '2026-12-01T09:00:00', 10, '2026-12-17', null],
  ['g', '2026-12-01T09:00:00', 15, '2026-12-24', null],
  ['h', '2026-12-29T10:00:00', 3, '2027-01-05', '2027-01-01'],
  ['i', '2026-12-31T23:59:00', 3, '2027-01-07', '2027-01-06'],
];

test('BR-12 SLA-01 table due dates', () => {
  for (const [row, paid, n, exp] of SLA01) {
    assert.equal(r.computeDueAt(T(paid), n, HOL, none), T(`${exp}T16:30:00`), `row ${row}`);
  }
  // Date object input + holidays as rows
  assert.equal(r.computeDueAt(new Date('2026-12-01T09:00:00+07:00'), 3, HOL.map((date) => ({ date })), none), T('2026-12-04T16:30:00'));
});

test('BR-12 D0 boundaries', () => {
  assert.equal(r.startDay(T('2026-12-01T16:29:59'), HOL, none), '2026-12-01');
  assert.equal(r.startDay(T('2026-12-01T16:30:00'), HOL, none), '2026-12-02');
  assert.equal(r.startDay(T('2026-12-05T10:00:00'), HOL, none), '2026-12-08'); // Sat → Sun, Mon 7 holiday
  assert.equal(r.startDay(T('2026-12-07T08:00:00'), HOL, none), '2026-12-08'); // holiday morning
  assert.equal(r.startDay(T('2026-12-31T23:59:00'), HOL, none), '2027-01-04');
  assert.equal(r.startDay(T('2026-12-01T00:00:00'), HOL, none), '2026-12-01');
});

test('B03 ignores holiday table only (weekends still skipped)', () => {
  const b = bug('B03');
  for (const [row, paid, n, , expBug] of SLA01) {
    if (!expBug) continue;
    assert.equal(r.computeDueAt(T(paid), n, HOL, b), T(`${expBug}T16:30:00`), `row ${row}`);
  }
  assert.equal(r.isWorkingDay('2026-12-07', HOL, b), true);
  assert.equal(r.isWorkingDay('2026-12-05', HOL, b), false);
  // pause (SLA-02 row 6) → 7 Dec instead of 8 Dec
  assert.equal(r.extendDueOnResubmit(T('2026-12-04T16:30:00'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), HOL, b), T('2026-12-07T16:30:00'));
  // B03 is scoped to due-date calculation only; levels still skip the holiday table (no leak into SLA-03/NOTI)
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: T('2026-12-08T16:30:00') }, T('2026-12-04T09:00:00'), HOL, b), 'near');
  // fee untouched
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }, b), 1010);
});

test('holiday added after payment does not move stored due (A-42)', () => {
  const due = r.computeDueAt(T('2026-12-01T09:00:00'), 3, HOL, none);
  assert.equal(due, T('2026-12-04T16:30:00'));
  // only the holiday table at payment time counts: with 2 Dec as holiday → 3, 4, 8
  assert.equal(r.computeDueAt(T('2026-12-01T09:00:00'), 3, [...HOL, '2026-12-02'], none), T('2026-12-08T16:30:00'));
});

// ── BR-13 / TEST-PLAN SLA-02 ────────────────────────────────────────
test('BR-13 pause during NEED_FIX', () => {
  const ext = (due, ret, sub, opts = none) => r.extendDueOnResubmit(T(due), T(ret), T(sub), HOL, opts);
  // part 1: returned Wed 2 11:00, resubmitted Thu 3 10:00 → +1
  assert.equal(ext('2026-12-04T16:30:00', '2026-12-02T11:00:00', '2026-12-03T10:00:00'), T('2026-12-08T16:30:00'));
  // part 2: seed …000017 due 27 Nov, returned 27 Nov, resubmit 1 Dec 09:00 → +2 (30 Nov, 1 Dec)
  assert.equal(r.pausedWorkingDays(T('2026-11-27T10:00:00'), T('2026-12-01T09:00:00'), HOL, none), 2);
  assert.equal(ext('2026-11-27T16:30:00', '2026-11-27T10:00:00', '2026-12-01T09:00:00'), T('2026-12-01T16:30:00'));
  // part 3: resubmit 4 Dec 10:00 → +5
  assert.equal(ext('2026-11-27T16:30:00', '2026-11-27T10:00:00', '2026-12-04T10:00:00'), T('2026-12-04T16:30:00'));
  // part 4: same day → +0
  assert.equal(ext('2026-12-04T16:30:00', '2026-12-02T09:00:00', '2026-12-02T15:00:00'), T('2026-12-04T16:30:00'));
  // part 5: returned Fri 4, resubmit Tue 8 17:00 → +1 (8 only) → 8 Dec, already overdue
  assert.equal(r.pausedWorkingDays(T('2026-12-04T10:00:00'), T('2026-12-08T17:00:00'), HOL, none), 1);
  const due5 = ext('2026-12-04T16:30:00', '2026-12-04T10:00:00', '2026-12-08T17:00:00');
  assert.equal(due5, T('2026-12-08T16:30:00'));
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: due5 }, T('2026-12-08T17:00:00'), HOL, none), 'overdue');
  // levels after resubmit
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: T('2026-12-08T16:30:00') }, T('2026-12-03T10:00:00'), HOL, none), 'normal');
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: T('2026-12-01T16:30:00') }, T('2026-12-01T09:00:00'), HOL, none), 'near');
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: T('2026-12-04T16:30:00') }, T('2026-12-04T10:00:00'), HOL, none), 'near');
});

test('B04 disables pause only', () => {
  const b = bug('B04');
  assert.equal(r.extendDueOnResubmit(T('2026-12-04T16:30:00'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), HOL, b), T('2026-12-04T16:30:00'));
  const due = r.extendDueOnResubmit(T('2026-11-27T16:30:00'), T('2026-11-27T10:00:00'), T('2026-12-01T09:00:00'), HOL, b);
  assert.equal(due, T('2026-11-27T16:30:00'));
  assert.equal(r.slaLevel({ status: 'IN_REVIEW', dueAt: due }, T('2026-12-01T09:00:00'), HOL, b), 'overdue');
  assert.equal(r.computeDueAt(T('2026-12-01T16:30:00'), 3, HOL, b), T('2026-12-08T16:30:00'));
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }, b), 1010);
});

test('bugs combine as union (B01,B03,B04)', () => {
  const b = bug('B01', 'B03', 'B04');
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }, b), 1000);
  assert.equal(r.computeDueAt(T('2026-12-01T16:30:00'), 3, HOL, b), T('2026-12-07T16:30:00'));
  assert.equal(r.extendDueOnResubmit(T('2026-12-04T16:30:00'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), HOL, b), T('2026-12-04T16:30:00'));
});

// ── BR-14 / TEST-PLAN SLA-03 ────────────────────────────────────────
test('BR-14 levels part A (due Fri 4 Dec 16:30)', () => {
  const c = { status: 'SUBMITTED', dueAt: T('2026-12-04T16:30:00') };
  const rows = [
    ['2026-12-01T09:00:00', 3, 'normal'],
    ['2026-12-02T09:00:00', 2, 'normal'],
    ['2026-12-03T09:00:00', 1, 'near'],
    ['2026-12-04T16:30:00', 0, 'near'],
    ['2026-12-04T16:30:01', null, 'overdue'],
    ['2026-12-04T16:31:00', null, 'overdue'],
    ['2026-12-05T10:00:00', null, 'overdue'],
  ];
  for (const [now, left, lvl] of rows) {
    if (left != null) assert.equal(r.daysRemaining(T(now), c.dueAt, HOL, none), left, now);
    assert.equal(r.slaLevel(c, T(now), HOL, none), lvl, now);
  }
});

test('BR-14 levels part B (due Tue 8 Dec, across weekend + 7 Dec)', () => {
  const c = { status: 'IN_REVIEW', due_at: T('2026-12-08T16:30:00') };
  const rows = [
    ['2026-12-03T09:00:00', 2, 'normal'],
    ['2026-12-04T09:00:00', 1, 'near'],
    ['2026-12-08T16:30:00', 0, 'near'],
    ['2026-12-08T16:31:00', null, 'overdue'],
  ];
  for (const [now, left, lvl] of rows) {
    if (left != null) assert.equal(r.daysRemaining(T(now), c.due_at, HOL, none), left, now);
    assert.equal(r.slaLevel(c, T(now), HOL, none), lvl, now);
  }
});

test('BR-14 levels part C (seed at 1 Dec 09:00) + statuses', () => {
  const now = T('2026-12-01T09:00:00');
  const lv = (due, status = 'SUBMITTED', at = now) => r.slaLevel({ status, dueAt: due && T(due) }, at, HOL, none);
  assert.equal(lv('2026-11-30T16:30:00'), 'overdue');
  assert.equal(lv('2026-12-01T16:30:00'), 'near');
  assert.equal(lv('2026-12-02T16:30:00'), 'near');
  assert.equal(lv('2026-12-03T16:30:00'), 'normal');
  assert.equal(lv('2026-11-27T16:30:00', 'NEED_FIX'), 'paused');
  for (const s of ['COMPLETED', 'REJECTED', 'CANCELLED']) assert.equal(lv('2026-11-27T16:30:00', s), 'closed');
  assert.equal(lv(null, 'PENDING_PAYMENT'), null);
  assert.equal(lv(null, 'DRAFT'), null);
  assert.equal(lv('2026-12-01T16:30:00', 'SUBMITTED', T('2026-12-01T16:30:00')), 'near');
  assert.equal(lv('2026-12-01T16:30:00', 'SUBMITTED', T('2026-12-01T16:31:00')), 'overdue');
  for (const s of ['IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED']) assert.equal(lv('2026-12-03T16:30:00', s), 'normal');
  assert.equal(r.levelLabel('near'), 'ใกล้ครบกำหนด');
  assert.equal(r.levelLabel('closed'), 'ปิดแล้ว');
  assert.equal(r.levelLabel('paused'), 'หยุดนับ');
});

// ── on time (DECISIONS §18) & queue order (BR-16) ───────────────────
test('on time ⇔ closed_at ≤ due', () => {
  const due = T('2026-12-04T16:30:00');
  assert.equal(r.isOnTime(T('2026-12-04T16:29:00'), due), true);
  assert.equal(r.isOnTime(T('2026-12-04T16:30:00'), due), true);
  assert.equal(r.isOnTime(T('2026-12-04T16:31:00'), due), false);
  assert.equal(r.isOnTime(null, due), false);
});

test('BR-16 queue order: due asc, then case no asc', () => {
  const items = [
    { caseNo: 'EG-2569-000028', dueAt: T('2026-12-04T16:30:00') },
    { caseNo: 'EG-2569-000020', dueAt: T('2026-11-30T16:30:00') },
    { caseNo: 'EG-2569-000015', dueAt: T('2026-12-04T16:30:00') },
    { caseNo: 'EG-2569-000099', dueAt: null },
    { caseNo: 'EG-2569-000013', dueAt: T('2026-12-04T16:30:00') },
    { case_no: 'EG-2569-000027', due_at: T('2026-12-04T16:30:00') },
  ];
  const order = items.sort(r.compareQueue).map((x) => x.caseNo || x.case_no);
  assert.deepEqual(order, ['EG-2569-000020', 'EG-2569-000013', 'EG-2569-000015', 'EG-2569-000027', 'EG-2569-000028', 'EG-2569-000099']);
});

test('working-day helpers', () => {
  assert.equal(r.isWorkingDay('2026-12-07', HOL, none), false);
  assert.equal(r.isWorkingDay('2026-12-08', HOL, none), true);
  assert.equal(r.isWorkingDay('2026-12-06', HOL, none), false);
  assert.equal(r.countWorkingDays('2026-12-04', '2026-12-04', HOL, none), 0);
  assert.equal(r.countWorkingDays('2026-12-05', '2026-12-01', HOL, none), 0);
  assert.equal(r.countWorkingDays('2026-12-01', '2026-12-17', HOL, none), 10);
  assert.equal(r.addWorkingDays('2026-12-30', 1, HOL, none), '2027-01-04');
  assert.equal(r.nextWorkingDay('2026-12-09', HOL, none), '2026-12-11');
});
