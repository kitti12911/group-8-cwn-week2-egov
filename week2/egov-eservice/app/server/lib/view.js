'use strict';
// View helpers available in every EJS template (res.locals):
//   user, roleTh, bellCount, fmt.dt(iso) "4 ธ.ค. 2569 16:30", fmt.date(iso), fmt.baht(n) "฿1,010",
//   timeTag(iso, testid) → <time data-testid=".." data-iso="2026-12-04T16:30:00+07:00">4 ธ.ค. 2569 16:30</time>
//   statusTag(code, testid='case-status') · levelTag(level, testid='sla-level') · labels · mask · nowIso
const { db } = require('../db');
const clock = require('./clock');
const time = require('./time');
const labels = require('./labels');
const mask = require('./mask');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = {
  dt: (v) => (v ? time.thaiDateTime(v) : ''),
  date: (v) => (v ? time.thaiDate(v) : ''),
  baht: (n) => time.baht(n),
  iso: (v) => (v ? time.toIso(v) : ''),
};

function timeTag(iso, testid, dateOnly = false) {
  if (!iso) return `<span${testid ? ` data-testid="${esc(testid)}"` : ''}>–</span>`;
  const v = time.toIso(iso);
  return `<time${testid ? ` data-testid="${esc(testid)}"` : ''} data-iso="${v}" datetime="${v}">${esc(dateOnly ? time.thaiDate(v) : time.thaiDateTime(v))}</time>`;
}

function statusTag(code, testid = 'case-status') {
  return `<span class="badge st-${esc(code)}" data-testid="${esc(testid)}" data-status="${esc(code)}">${esc(labels.STATUS_TH[code] || code)}</span>`;
}

function levelTag(level, testid = 'sla-level') {
  return `<span class="badge lv-${esc(level)}" data-testid="${esc(testid)}" data-level="${esc(level)}">${esc(labels.LEVEL_TH[level] || level)}</span>`;
}

function locals(req, res, next) {
  const u = req.user;
  res.locals.user = u || null;
  res.locals.roleTh = u ? labels.ROLE_TH[u.role] || u.role : '';
  res.locals.bellCount = 0;
  if (u && (u.role === 'officer' || u.role === 'head')) {
    res.locals.bellCount = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE username = ?').get(u.username).n;
  }
  res.locals.currentPath = req.path;
  res.locals.title = '';
  res.locals.fmt = fmt;
  res.locals.timeTag = timeTag;
  res.locals.statusTag = statusTag;
  res.locals.levelTag = levelTag;
  res.locals.labels = labels;
  res.locals.mask = mask;
  res.locals.esc = esc;
  res.locals.nowIso = clock.nowIso();
  next();
}

module.exports = { locals, fmt, timeTag, statusTag, levelTag, esc };
