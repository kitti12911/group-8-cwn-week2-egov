'use strict';
// B09 · Notifications (bell) — FR-20 · BR-14/BR-15 · DECISIONS §8 + §18 · CONTRACT §0.7 §2.12 §6.3 · A-30 A-31
//
// Evaluation (hooks.onRequest → every HTTP request except /api/test/*; runs after the auto-cancel hooks):
//   for every open case (not closed, not NEED_FIX, has due_at) compute the CURRENT level with rules.slaLevel
//   (no back-fill of a level that was skipped when the clock jumped, A-30). For near/overdue → receivers:
//     PENDING_APPROVAL → head (owner if it is a head, else every active head)
//     APPROVED         → issuer (fallback: every officer of registry)
//     holder (owner)   → holder
//     no holder        → every active officer of the dept the case is in (cases.dept / ctx.officer.currentDept)
//     overdue          → + every active head (deduped)
//   INSERT OR IGNORE on UNIQUE(username, case_id, level) ⇒ 1 per level per case per person, never repeated.
// After reset the table is empty until the first non-test request (reset itself is /api/test/*).
//
// Pages / API:  GET /notifications (view notifications.ejs) · GET /api/notifications → {items:[{id,caseNo,level,text,createdAt}]}
// RBAC (officer/head only) is enforced centrally by auth.js; handlers re-check defensively.
// Exposes ctx.notifications = { evaluate(now?), receiversFor(caseRow, level), listFor(username) }

const rules = require('./rules');

module.exports = function register(app, ctx) {
  const { db, clock, time, hooks, guard, errors } = ctx;

  const LEVEL_TEXT = { near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด' };
  const textOf = (caseNo, level) => `คำขอ ${caseNo} ${LEVEL_TEXT[level]}`;

  const qOpenCases = db.prepare(`SELECT id, case_no, service_id, status, step, dept, owner, issuer, due_at
    FROM cases WHERE deleted = 0 AND case_no IS NOT NULL AND due_at IS NOT NULL
      AND status IN ('SUBMITTED','IN_REVIEW','PENDING_APPROVAL','APPROVED')`);
  const qActiveStaff = db.prepare('SELECT username, role, dept FROM staff WHERE active = 1');
  const qInsert = db.prepare(`INSERT OR IGNORE INTO notifications(username, case_id, case_no, level, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const qList = db.prepare(`SELECT id, case_no, level, text, created_at FROM notifications
    WHERE username = ? ORDER BY created_at DESC, case_no DESC, id ASC`);

  function deptOf(c) {
    if (ctx.officer && typeof ctx.officer.currentDept === 'function') {
      try { return ctx.officer.currentDept(c); } catch (e) { /* fall through */ }
    }
    if (c.dept) return c.dept;
    if (c.service_id === 'SV-03' && Number(c.step) === 2) return 'works';
    return 'registry';
  }

  function receiversFor(c, level, staffRows) {
    const staff = staffRows || qActiveStaff.all();
    const byName = new Map(staff.map((s) => [s.username, s]));
    const heads = staff.filter((s) => s.role === 'head').map((s) => s.username);
    const deptOfficers = (d) => staff.filter((s) => s.role === 'officer' && s.dept === d).map((s) => s.username);
    const out = new Set();

    if (c.status === 'PENDING_APPROVAL') {
      const o = c.owner && byName.get(c.owner);
      if (o && o.role === 'head') out.add(o.username);
      else heads.forEach((h) => out.add(h));
    } else if (c.status === 'APPROVED') {
      if (c.issuer && byName.has(c.issuer)) out.add(c.issuer);
      else deptOfficers('registry').forEach((u) => out.add(u));
    } else if (c.owner && byName.has(c.owner)) {
      out.add(c.owner);
    } else {
      const d = deptOf(c);
      if (d === 'head') heads.forEach((h) => out.add(h));
      else deptOfficers(d).forEach((u) => out.add(u));
    }
    if (level === 'overdue') heads.forEach((h) => out.add(h));
    return [...out];
  }

  function evaluate(nowArg) {
    const now = nowArg || clock.now();
    const nowIso = time.toIso(now);
    const cases = qOpenCases.all();
    if (!cases.length) return 0;
    const holidays = rules.loadHolidays(db);
    const staff = qActiveStaff.all();
    let added = 0;
    db.transaction(() => {
      for (const c of cases) {
        const level = rules.slaLevel({ status: c.status, dueAt: c.due_at }, now, holidays);
        if (level !== 'near' && level !== 'overdue') continue;
        const text = textOf(c.case_no, level);
        for (const u of receiversFor(c, level, staff)) {
          added += qInsert.run(u, c.id, c.case_no, level, text, nowIso).changes;
        }
      }
    })();
    return added;
  }

  function listFor(username) {
    return qList.all(username).map((r) => ({
      id: r.id, caseNo: r.case_no, level: r.level, text: r.text, createdAt: time.toIso(r.created_at),
    }));
  }

  hooks.onRequest(() => evaluate());

  const isBellUser = (u) => u && u.type === 'staff' && (u.role === 'officer' || u.role === 'head');

  app.get('/notifications', guard.page('officer', 'head'), (req, res) => {
    const items = listFor(req.user.username);
    res.render('notifications', { title: 'แจ้งเตือน', items });
  });

  app.get('/api/notifications', guard.api('officer', 'head'), (req, res) => {
    if (!isBellUser(req.user)) return errors.sendError(res, 'FORBIDDEN');
    res.json({ items: listFor(req.user.username) });
  });

  ctx.notifications = { evaluate, receiversFor, listFor, textOf };
};
