'use strict';
// B11 · Audit Trail (FR-24 · BR-27 · DECISIONS §13) + admin pages (FR-25/26/27 · BR-28 · DECISIONS §18)
// Pages : GET /audit (auditor) · GET /admin/services|holidays|users (admin)
// API   : GET /api/audit · GET /api/audit/export.csv (auditor) · PUT|PATCH|DELETE|POST /api/audit[/…] → 405 for everyone
//         GET /api/admin/services · PUT /api/admin/services/:id
//         GET|POST /api/admin/holidays · DELETE /api/admin/holidays/:date
//         GET /api/admin/users · PUT /api/admin/users/:username
module.exports = function register(app, ctx) {
  const { db, audit, errors, guard, time } = ctx;
  const { AppError, sendError } = errors;

  const ROLES = ['citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
  const STAFF_ROLES = ['officer', 'head', 'executive', 'auditor', 'admin'];
  const DEPTS = ['registry', 'works'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ───────────────────────── helpers ─────────────────────────
  function isRealDate(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** strict integer: JS integer number, or a string of digits (form posts). Anything else → null */
  function toInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
    return null;
  }
  const feeOk = (n) => n !== null && n >= 0 && n <= 100000;
  const slaOk = (n) => n !== null && n >= 1 && n <= 60;

  function adminChange(req, detail) {
    audit.log({ user: req.user, event: 'ADMIN_CHANGE', detail });
  }

  // ───────────────────────── Audit Trail ─────────────────────────
  const AUDIT_COLS = ['time', 'username', 'role', 'event', 'caseNo', 'fromStatus', 'toStatus', 'detail'];

  function parseFilters(q) {
    const f = {
      actor: typeof q.actor === 'string' ? q.actor.trim() : '',
      event: typeof q.event === 'string' ? q.event.trim() : '',
      from: typeof q.from === 'string' ? q.from.trim() : '',
      to: typeof q.to === 'string' ? q.to.trim() : '',
    };
    if (f.event && !audit.EVENTS.includes(f.event)) throw new AppError('BAD_REQUEST');
    if (f.from && !isRealDate(f.from)) throw new AppError('BAD_REQUEST');
    if (f.to && !isRealDate(f.to)) throw new AppError('BAD_REQUEST');
    return f;
  }

  /** newest → oldest (same time: higher id first). Dates compare on the stored +07:00 wall-clock date, inclusive both ends. */
  function queryAudit(f) {
    const where = [];
    const args = [];
    if (f.actor) {
      where.push("username LIKE ? ESCAPE '\\'");
      args.push('%' + f.actor.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    }
    if (f.event) { where.push('event = ?'); args.push(f.event); }
    if (f.from) { where.push('substr(time, 1, 10) >= ?'); args.push(f.from); }
    if (f.to) { where.push('substr(time, 1, 10) <= ?'); args.push(f.to); }
    const sql = 'SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY time DESC, id DESC';
    return db.prepare(sql).all(...args).map(audit.toApi);
  }

  function filterQs(f) {
    const p = new URLSearchParams();
    for (const k of ['actor', 'event', 'from', 'to']) if (f[k]) p.set(k, f[k]);
    return p.toString();
  }

  // Formula-injection guard for spreadsheet apps: cells starting with = + - @ are prefixed with '
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(items) {
    const lines = [AUDIT_COLS.join(',')];
    for (const r of items) lines.push(AUDIT_COLS.map((c) => csvCell(r[c])).join(','));
    return lines.join('\n'); // UTF-8, no BOM (first header cell must be exactly "time")
  }

  // append-only: no write method on any /api/audit path for any role (even for ids that don't exist)
  function readOnly(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    res.set('Allow', 'GET, HEAD');
    return sendError(res, 'METHOD_NOT_ALLOWED');
  }
  app.all('/api/audit', readOnly);
  app.all('/api/audit/:id', readOnly);
  app.all('/audit', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    res.set('Allow', 'GET, HEAD');
    return sendError(res, 'METHOD_NOT_ALLOWED');
  });

  app.get('/api/audit', guard.api('auditor'), (req, res) => {
    const f = parseFilters(req.query);
    const items = queryAudit(f);
    res.json({ count: items.length, items });
  });

  app.get('/api/audit/export.csv', guard.api('auditor'), (req, res) => {
    const f = parseFilters(req.query);
    const items = queryAudit(f); // list first, so the EXPORT row of this download is not inside it
    const body = toCsv(items);
    audit.log({ user: req.user, event: 'EXPORT', detail: 'audit-csv' });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="audit.csv"');
    res.set('Cache-Control', 'no-store');
    res.send(body);
  });

  app.get('/audit', guard.page('auditor'), (req, res) => {
    const f = parseFilters(req.query);
    const items = queryAudit(f);
    const q = filterQs(f);
    res.render('audit', {
      title: 'Audit Trail', items, filters: f, events: audit.EVENTS,
      exportHref: '/api/audit/export.csv' + (q ? '?' + q : ''),
    });
  });

  // ───────────────────────── Admin · services ─────────────────────────
  const svcRow = (s) => ({ id: s.id, name: s.name, fee: s.fee, feePerSqm: s.fee_per_sqm == null ? null : s.fee_per_sqm, sla: s.sla });
  const listServices = () => db.prepare('SELECT * FROM services ORDER BY sort, id').all().map(svcRow);

  app.get('/api/admin/services', guard.api('admin'), (req, res) => res.json({ items: listServices() }));

  app.put('/api/admin/services/:id', guard.api('admin'), (req, res) => {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!svc) return sendError(res, 'NOT_FOUND', {}, 'ไม่พบบริการ');
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const hasFee = b.fee !== undefined || b.feeBase !== undefined;
    const hasPerSqm = svc.id === 'SV-03' && b.feePerSqm !== undefined;
    const hasSla = b.sla !== undefined;
    if (!hasFee && !hasPerSqm && !hasSla) return sendError(res, 'BAD_REQUEST');

    // validate everything first → nothing is written when any value is out of range
    const fee = hasFee ? toInt(b.fee !== undefined ? b.fee : b.feeBase) : undefined;
    const perSqm = hasPerSqm ? toInt(b.feePerSqm) : undefined;
    const sla = hasSla ? toInt(b.sla) : undefined;
    if (hasFee && !feeOk(fee)) return sendError(res, 'INVALID_FEE');
    if (hasPerSqm && !feeOk(perSqm)) return sendError(res, 'INVALID_FEE');
    if (hasSla && !slaOk(sla)) return sendError(res, 'INVALID_SLA');

    db.transaction(() => {
      if (hasFee && fee !== svc.fee) {
        db.prepare('UPDATE services SET fee = ? WHERE id = ?').run(fee, svc.id);
        adminChange(req, `${svc.id} fee ${svc.fee} → ${fee}`);
      }
      if (hasPerSqm && perSqm !== svc.fee_per_sqm) {
        db.prepare('UPDATE services SET fee_per_sqm = ? WHERE id = ?').run(perSqm, svc.id);
        adminChange(req, `${svc.id} feePerSqm ${svc.fee_per_sqm} → ${perSqm}`);
      }
      if (hasSla && sla !== svc.sla) {
        db.prepare('UPDATE services SET sla = ? WHERE id = ?').run(sla, svc.id);
        adminChange(req, `${svc.id} sla ${svc.sla} → ${sla}`);
      }
    })();
    res.json(svcRow(db.prepare('SELECT * FROM services WHERE id = ?').get(svc.id)));
  });

  app.get('/admin', guard.page('admin'), (req, res) => res.redirect('/admin/services'));
  app.get('/admin/services', guard.page('admin'), (req, res) => {
    res.render('admin-services', { title: 'ค่าธรรมเนียมและ SLA', items: listServices() });
  });

  // ───────────────────────── Admin · holidays ─────────────────────────
  const listHolidays = () => db.prepare('SELECT date, name FROM holidays ORDER BY date').all();

  app.get('/api/admin/holidays', guard.api('admin'), (req, res) => res.json({ items: listHolidays() }));

  app.post('/api/admin/holidays', guard.api('admin'), (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const date = typeof b.date === 'string' ? b.date.trim() : '';
    if (!isRealDate(date)) return sendError(res, 'BAD_REQUEST', {}, 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 200) : 'วันหยุด';
    const result = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(date)) return false;
      db.prepare('INSERT INTO holidays(date, name) VALUES (?, ?)').run(date, name);
      adminChange(req, `holiday add ${date}`);
      return true;
    })();
    if (!result) return sendError(res, 'DUPLICATE_HOLIDAY');
    res.status(201).json({ date, name });
  });

  app.delete('/api/admin/holidays/:date', guard.api('admin'), (req, res) => {
    const date = req.params.date;
    const result = db.transaction(() => {
      const info = db.prepare('DELETE FROM holidays WHERE date = ?').run(date);
      if (!info.changes) return false;
      adminChange(req, `holiday delete ${date}`);
      return true;
    })();
    if (!result) return sendError(res, 'NOT_FOUND', {}, 'ไม่พบวันหยุด');
    res.json({ ok: true, date });
  });

  app.get('/admin/holidays', guard.page('admin'), (req, res) => {
    res.render('admin-holidays', { title: 'วันหยุด', items: listHolidays() });
  });

  // ───────────────────────── Admin · users ─────────────────────────
  const userRow = (u) => ({ username: u.username, name: u.name, role: u.role, dept: u.dept || '', active: !!u.active });
  const listUsers = () => db.prepare('SELECT * FROM staff ORDER BY id').all().map(userRow);

  app.get('/api/admin/users', guard.api('admin'), (req, res) => res.json({ items: listUsers() }));

  app.put('/api/admin/users/:username', guard.api('admin'), (req, res) => {
    const target = db.prepare('SELECT * FROM staff WHERE username = ?').get(req.params.username);
    if (!target) return sendError(res, 'NOT_FOUND', {}, 'ไม่พบผู้ใช้');
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const role = b.role === undefined ? target.role : b.role;
    if (typeof role !== 'string' || !ROLES.includes(role)) return sendError(res, 'BAD_REQUEST');
    if (!STAFF_ROLES.includes(role)) return sendError(res, 'BAD_REQUEST', {}, 'บัญชีเจ้าหน้าที่ตั้งเป็นประชาชนไม่ได้');

    let dept = b.dept === undefined || b.dept === null ? target.dept || '' : b.dept;
    if (typeof dept !== 'string') return sendError(res, 'BAD_REQUEST');
    dept = dept.trim();
    if (dept && !DEPTS.includes(dept)) return sendError(res, 'BAD_REQUEST');
    if (role === 'officer' && !dept) return sendError(res, 'BAD_REQUEST', {}, 'เจ้าหน้าที่ต้องระบุแผนก (registry / works)');
    if (role !== 'officer') dept = DEPTS.includes(target.dept) ? '' : target.dept || '';

    const roleChanged = role !== target.role;
    const deptChanged = dept !== (target.dept || '');
    // BR-28: admin cannot change their own role (checked against the session snapshot username)
    if (target.username === req.user.username && (roleChanged || deptChanged)) return sendError(res, 'SELF_ROLE_CHANGE');

    db.transaction(() => {
      if (roleChanged || deptChanged) db.prepare('UPDATE staff SET role = ?, dept = ? WHERE id = ?').run(role, dept, target.id);
      if (roleChanged) adminChange(req, `${target.username} role ${target.role} → ${role}`);
      if (deptChanged) adminChange(req, `${target.username} dept ${target.dept || '-'} → ${dept || '-'}`);
    })();
    res.json(userRow(db.prepare('SELECT * FROM staff WHERE id = ?').get(target.id)));
    // existing sessions keep their snapshot → takes effect at next login (CONTRACT §6.5)
  });

  app.get('/admin/users', guard.page('admin'), (req, res) => {
    res.render('admin-users', { title: 'ผู้ใช้และบทบาท', items: listUsers(), roles: ROLES });
  });
};
