'use strict';
// B07 · Officer workflow: queue · claim · return · route (forward) · approve/reject · issue · unmask · attachments
//   FR-12 queue per dept (BR-16 order) · FR-13 claim (BR-17 one holder, BR-18 ≤ 10 IN_REVIEW in hand, checked only at claim)
//   FR-14 return ≤ 2 (BR-19 reason ≥ 10 after trim) · FR-15 automatic routing by services.route (no target choice)
//   FR-16 approve/reject by authority (SV-01 holder officer · SV-02/03 head at PENDING_APPROVAL) · FR-21 masked ID + unmask
//   FR-29 / BR-29 attachments by role · DECISIONS §9 §10 §11 §18 · CONTRACT §2.6 §2.7 §2.8 §6.3
// BUG_MODE: B07 officer may approve SV-02/03 via API · B08 claim skips the "already has a holder" check
//           B09 queue API leaks full idNo · B11 unmask not audited · B12 third return allowed (+ return-btn stays)
//
// Case model (same as seed.js): cases.dept = queue dept (registry|works; NULL at PENDING_APPROVAL / closed)
//   cases.step = SV-03 step 1|2|3 (else NULL) · cases.owner = holder (PENDING_APPROVAL → head username)
//   cases.issuer = who presses "ออกเอกสาร" (SV-01 approver · SV-02/03 registry step-1 holder, A-27)
//   case_handlers(step 1 registry · 2 works · 9 head) = departments the case has been through (BR-29)
//
// Exposes ctx.officer = { caseJson, loadCase, currentDept, staffCanAccess, workload, computeValidUntil }
// Doc creation can be overridden by B08: ctx.documents.create(caseRow, { issuedBy, now }) → { docNo, verifyCode }

const nodeCrypto = require('crypto');
const QRCode = require('qrcode');
const rules = require('./rules');

const WORKLOAD_MAX = 10; // BR-18
const RETURN_MAX = 2; // BR-19
const REASON_MIN = 10; // BR-19 (after trim)
const FIX_WINDOW_HOURS = 168; // BR-20
const QUEUE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED']; // TC-QUEUE-01 (NEED_FIX / PENDING_APPROVAL / closed are not in the queue)
const STEP_LABEL = { 1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน', 2: 'ขั้นตอน 2/3 · ฝ่ายโยธา', 3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย' };
const HANDLER_STEP = { registry: 1, works: 2, head: 9 };
const VERIFY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

module.exports = function register(app, ctx) {
  const { db, clock, time, mask, crypto, errors, guard, audit, bugMode, hooks, labels, nextNumber } = ctx;
  const { AppError } = errors;

  // ─────────────────────────── data access ───────────────────────────
  const str = (v) => (v == null ? '' : String(v));
  const chars = (s) => Array.from(s).length;

  const CASE_SQL = `SELECT c.*, s.name AS service_name, s.approver AS approver, s.route AS route_json,
      z.full_name AS applicant_name, z.id_enc AS applicant_id_enc
    FROM cases c JOIN services s ON s.id = c.service_id JOIN citizens z ON z.id = c.citizen_id`;

  function loadCase(caseNo) {
    if (!caseNo) return null;
    return db.prepare(`${CASE_SQL} WHERE c.case_no = ? AND c.deleted = 0`).get(str(caseNo)) || null;
  }
  function mustCase(caseNo) {
    const c = loadCase(caseNo);
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  function routeOf(c) {
    try {
      const r = JSON.parse(c.route_json || '[]');
      if (Array.isArray(r) && r.length) return r;
    } catch (e) { /* fall through */ }
    return c.service_id === 'SV-01' ? ['registry'] : c.service_id === 'SV-02' ? ['registry', 'head'] : ['registry', 'works', 'head'];
  }

  /** department currently responsible: registry | works | head */
  function currentDept(c) {
    if (c.status === 'PENDING_APPROVAL') return 'head';
    if (c.dept) return c.dept;
    if (c.service_id === 'SV-03' && Number(c.step) === 2) return 'works';
    return 'registry'; // SUBMITTED cases always start at registry (first step of every route)
  }

  function handlerDepts(c) {
    return new Set(db.prepare('SELECT dept FROM case_handlers WHERE case_id = ?').all(c.id).map((r) => r.dept));
  }

  /** BR-29: officer = own dept, current step or passed · head = all · others = no */
  function staffCanAccess(user, c) {
    if (!user || !c) return false;
    if (user.role === 'head') return true;
    if (user.role !== 'officer') return false;
    const d = user.dept;
    if (!d) return false;
    if (d === 'registry' && c.case_no) return true; // every route starts at registry
    if (currentDept(c) === d && c.status !== 'PENDING_APPROVAL') return true;
    if (handlerDepts(c).has(d)) return true;
    if (d === 'works' && c.service_id === 'SV-03' && Number(c.step) >= 2) return true;
    return false;
  }

  const workload = (username) =>
    db.prepare("SELECT COUNT(*) AS n FROM cases WHERE status = 'IN_REVIEW' AND owner = ? AND deleted = 0").get(username).n;

  const headUsername = () => {
    const r = db.prepare("SELECT username FROM staff WHERE role = 'head' AND active = 1 ORDER BY id LIMIT 1").get();
    return r ? r.username : null;
  };
  const staffName = (username) => {
    if (!username) return '';
    const r = db.prepare('SELECT name FROM staff WHERE username = ?').get(username);
    return r ? r.name : username;
  };

  function issuerOf(c) {
    if (c.issuer) return c.issuer;
    if (c.service_id === 'SV-01') return c.approved_by || c.owner || null;
    const h = db.prepare('SELECT username FROM case_handlers WHERE case_id = ? AND step = 1').get(c.id);
    return h ? h.username : null;
  }

  function idNoOf(c) {
    try { return crypto.decrypt(c.applicant_id_enc); } catch (e) { return ''; }
  }

  function docOf(c) {
    if (c.doc_no) {
      const d = db.prepare('SELECT doc_no, verify_code FROM documents WHERE doc_no = ?').get(c.doc_no);
      if (d) return d;
    }
    return db.prepare('SELECT doc_no, verify_code FROM documents WHERE case_id = ? ORDER BY issued_at DESC LIMIT 1').get(c.id) || null;
  }

  const levelOf = (c, hol) => rules.slaLevel({ status: c.status, dueAt: c.due_at }, clock.now(), hol || rules.loadHolidays(db));

  /** CONTRACT §6.7 JSON. Staff: idMasked only (never idNo). Citizen owner: idNo instead of idMasked. */
  function caseJson(c, viewer, hol) {
    const doc = docOf(c);
    const base = {
      caseNo: c.case_no, serviceId: c.service_id, status: c.status,
      step: c.service_id === 'SV-03' && c.step != null ? Number(c.step) : null,
      fee: c.fee, paidAt: c.paid_at || null, dueAt: c.due_at || null, slaLevel: levelOf(c, hol),
      owner: c.owner || null, returnCount: Number(c.return_count || 0), closedAt: c.closed_at || null,
      applicantName: c.applicant_name,
    };
    const idNo = idNoOf(c);
    if (viewer && viewer.role === 'citizen') base.idNo = idNo;
    else base.idMasked = mask.maskId(idNo);
    base.fixDeadline = c.status === 'NEED_FIX' ? c.fix_deadline || null : null;
    base.docNo = doc ? doc.doc_no : null;
    base.verifyCode = doc ? doc.verify_code : null;
    return base;
  }

  function queueItem(c, hol) {
    const idNo = idNoOf(c);
    const item = {
      caseNo: c.case_no, serviceId: c.service_id, applicantName: c.applicant_name,
      idMasked: mask.maskId(idNo), status: c.status,
      step: c.service_id === 'SV-03' && c.step != null ? Number(c.step) : null,
      owner: c.owner || null, dueAt: c.due_at || null, slaLevel: levelOf(c, hol),
    };
    if (bugMode('B09')) item.idNo = idNo; // B09: full ID leaks in the queue API (screen still masked)
    return item;
  }

  /** queue rows for a staff user, BR-16 order. filter: all | unclaimed | mine */
  function queueFor(user, filter) {
    const rows = db.prepare(`${CASE_SQL} WHERE c.deleted = 0 AND c.case_no IS NOT NULL
      AND c.status IN (${QUEUE_STATUSES.map(() => '?').join(',')})`).all(...QUEUE_STATUSES);
    let list = rows.filter((c) => (user.role === 'head' ? true : currentDept(c) === user.dept));
    if (filter === 'unclaimed') list = list.filter((c) => (c.status === 'SUBMITTED' || c.status === 'IN_REVIEW') && !c.owner);
    else if (filter === 'mine') list = list.filter((c) => c.status === 'IN_REVIEW' && c.owner === user.username);
    return list.sort(rules.compareQueue);
  }

  function approvalsList() {
    return db.prepare(`${CASE_SQL} WHERE c.deleted = 0 AND c.status = 'PENDING_APPROVAL'`).all().sort(rules.compareQueue);
  }

  const normFilter = (f) => (['all', 'unclaimed', 'mine'].includes(f) ? f : 'all');

  // ─────────────────────────── permissions per action ───────────────────────────
  const isHolder = (user, c) => user && user.role === 'officer' && c.owner === user.username && currentDept(c) === user.dept;

  function canClaim(user, c) {
    return !!user && user.role === 'officer' && currentDept(c) === user.dept && !c.owner &&
      (c.status === 'SUBMITTED' || c.status === 'IN_REVIEW');
  }
  function canReturnUi(user, c) {
    return isHolder(user, c) && c.status === 'IN_REVIEW' && (Number(c.return_count) < RETURN_MAX || bugMode('B12'));
  }
  function canForwardUi(user, c) {
    if (!isHolder(user, c) || c.status !== 'IN_REVIEW') return false;
    const r = routeOf(c);
    return r.indexOf(currentDept(c)) >= 0 && r.indexOf(currentDept(c)) < r.length - 1;
  }
  /** UI decision buttons (approve / reject). B07 does NOT add a button — the bug is API-only. */
  function canDecideUi(user, c) {
    if (c.approver === 'officer') return isHolder(user, c) && c.status === 'IN_REVIEW';
    return !!user && user.role === 'head' && c.status === 'PENDING_APPROVAL';
  }
  function canIssueUi(user, c) {
    return !!user && user.role === 'officer' && c.status === 'APPROVED' && issuerOf(c) === user.username;
  }

  /** approve / reject authority (API). kind = 'approve' | 'reject' */
  function checkDecision(user, c, kind) {
    if (c.approver === 'officer') { // SV-01: holder officer at IN_REVIEW
      if (!user || user.role !== 'officer') throw new AppError('FORBIDDEN'); // head cannot decide SV-01
      if (currentDept(c) !== user.dept) throw new AppError('FORBIDDEN');
      if (c.status === 'IN_REVIEW' && c.owner !== user.username) throw new AppError('FORBIDDEN');
      if (c.status !== 'IN_REVIEW') {
        if (c.owner && c.owner !== user.username) throw new AppError('FORBIDDEN');
        throw new AppError('INVALID_STATE');
      }
      return;
    }
    // SV-02 / SV-03: head at PENDING_APPROVAL
    if (user && user.role === 'head') {
      if (c.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE');
      return;
    }
    if (kind === 'approve' && bugMode('B07') && user && user.role === 'officer') {
      // B07: officer approves SV-02/03 directly — API skips the authority check (button stays hidden)
      if (c.status !== 'PENDING_APPROVAL' && c.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
      return;
    }
    throw new AppError('FORBIDDEN');
  }

  function reasonOf(body) {
    return str(body && body.reason).trim();
  }

  // ─────────────────────────── writes ───────────────────────────
  function event(caseId, actor, from, to, note, at) {
    db.prepare('INSERT INTO case_events(case_id, time, actor, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(caseId, at || clock.nowIso(), actor, from || null, to || null, note || '');
  }

  function enterHandler(caseId, dept, username, now) {
    const step = HANDLER_STEP[dept] || 1;
    const row = db.prepare('SELECT * FROM case_handlers WHERE case_id = ? AND step = ?').get(caseId, step);
    if (row) {
      db.prepare('UPDATE case_handlers SET username = COALESCE(?, username), left_at = NULL WHERE case_id = ? AND step = ?')
        .run(username, caseId, step);
    } else {
      db.prepare('INSERT INTO case_handlers(case_id, step, dept, username, entered_at, left_at) VALUES (?, ?, ?, ?, ?, NULL)')
        .run(caseId, step, dept, username, now);
    }
  }
  function leaveHandler(caseId, dept, now) {
    const step = HANDLER_STEP[dept] || 1;
    db.prepare('UPDATE case_handlers SET left_at = ? WHERE case_id = ? AND step = ? AND left_at IS NULL').run(now, caseId, step);
  }

  /** BR-23 last valid day 'YYYY-MM-DD': SV-01 issue + 89 days · SV-02/03 anniversary − 1 day (29 Feb → 28 Feb anniversary) */
  function computeValidUntil(serviceId, issuedAt) {
    const p = time.parts(issuedAt);
    const fmt = (dt) => `${dt.getUTCFullYear()}-${time.pad(dt.getUTCMonth() + 1)}-${time.pad(dt.getUTCDate())}`;
    if (serviceId === 'SV-01') return fmt(new Date(Date.UTC(p.y, p.m - 1, p.d + 89)));
    const y = p.y + 1;
    const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
    const annivDay = p.m === 2 && p.d === 29 && !leap(y) ? 28 : p.d;
    return fmt(new Date(Date.UTC(y, p.m - 1, annivDay - 1)));
  }

  function newVerifyCode() {
    for (;;) {
      const bytes = nodeCrypto.randomBytes(8);
      let code = '';
      for (let i = 0; i < 8; i++) code += VERIFY_ALPHABET[bytes[i] % VERIFY_ALPHABET.length];
      if (!db.prepare('SELECT 1 FROM documents WHERE verify_code = ?').get(code)) return code;
    }
  }

  /** default document creator (B08 can replace via ctx.documents.create) */
  function createDocument(c, issuedBy, now) {
    if (ctx.documents && typeof ctx.documents.create === 'function') {
      const r = ctx.documents.create(c, { issuedBy, now });
      if (r && r.docNo) return { docNo: r.docNo, verifyCode: r.verifyCode };
    }
    const be = time.beYear(now);
    const docNo = `DOC-${be}-${String(nextNumber('doc', be)).padStart(6, '0')}`;
    const verifyCode = newVerifyCode();
    const issuedAt = time.toIso(now);
    const validUntil = computeValidUntil(c.service_id, now);
    const signer = staffName(c.approved_by);
    const applicant = c.applicant_name;
    const signature = crypto.sign([docNo, c.case_no, applicant, c.service_id, issuedAt, validUntil, signer]);
    db.prepare(`INSERT INTO documents(doc_no, case_id, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, issued_by, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(docNo, c.id, c.case_no, verifyCode, applicant, c.service_id, issuedAt, validUntil, signer, issuedBy, signature);
    return { docNo, verifyCode };
  }

  // ─────────────────────────── auto-cancel (BR-20 / A-46) ───────────────────────────
  // Fallback: payments.js (B06) normally cancels first; this is idempotent (only NEED_FIX past the deadline).
  hooks.onRequest(() => {
    const now = clock.nowIso();
    const due = db.prepare(`SELECT id, fix_deadline FROM cases WHERE status = 'NEED_FIX' AND deleted = 0
      AND fix_deadline IS NOT NULL`).all().filter((r) => time.toDate(r.fix_deadline).getTime() <= time.toDate(now).getTime());
    if (!due.length) return;
    db.transaction(() => {
      for (const r of due) {
        const at = time.toIso(r.fix_deadline);
        const ch = db.prepare(`UPDATE cases SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?
          WHERE id = ? AND status = 'NEED_FIX'`).run(at, at, r.id);
        if (ch.changes) event(r.id, 'system', 'NEED_FIX', 'CANCELLED', 'หมดเวลาแก้ไข ระบบยกเลิกอัตโนมัติ', at);
      }
    })();
  });

  // ─────────────────────────── API §6.3 ───────────────────────────
  // GET /api/officer/queue?filter=all|unclaimed|mine (officer · head; central guard 401/403)
  app.get('/api/officer/queue', (req, res) => {
    const filter = normFilter(req.query.filter);
    const hol = rules.loadHolidays(db);
    const items = queueFor(req.user, filter).map((c) => queueItem(c, hol));
    const body = { filter, items };
    if (req.user.role === 'officer') body.workload = workload(req.user.username);
    res.json(body);
  });

  // POST /api/officer/cases/:caseNo/claim → 200 {"owner"} · order: permission → ALREADY_CLAIMED → WORKLOAD_LIMIT
  app.post('/api/officer/cases/:caseNo/claim', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      if (user.role !== 'officer' || !user.dept || currentDept(c) !== user.dept) throw new AppError('FORBIDDEN');
      const held = !!c.owner && ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX'].includes(c.status);
      if (held && !bugMode('B08')) throw new AppError('ALREADY_CLAIMED'); // B08 skips this check
      if (c.status !== 'SUBMITTED' && c.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
      if (workload(user.username) >= WORKLOAD_MAX) throw new AppError('WORKLOAD_LIMIT');
      const now = clock.nowIso();
      const dept = currentDept(c);
      const guardSql = bugMode('B08') ? '' : ' AND owner IS NULL';
      const ch = db.prepare(`UPDATE cases SET status = 'IN_REVIEW', owner = ?, dept = ?, updated_at = ?,
          step = CASE WHEN service_id = 'SV-03' THEN COALESCE(step, 1) ELSE step END
        WHERE id = ? AND status IN ('SUBMITTED','IN_REVIEW')${guardSql}`).run(user.username, dept, now, c.id);
      if (!ch.changes) throw new AppError('ALREADY_CLAIMED');
      enterHandler(c.id, dept, user.username, now);
      if (dept === 'registry') db.prepare('UPDATE cases SET issuer = ? WHERE id = ?').run(user.username, c.id); // A-27
      event(c.id, user.username, c.status, 'IN_REVIEW', 'รับเรื่อง', now);
      audit.log({ user, event: 'CLAIM', caseNo: c.case_no, fromStatus: c.status, toStatus: 'IN_REVIEW' });
      return { owner: user.username, status: 'IN_REVIEW' };
    })();
    res.json(out);
  });

  // POST /api/officer/cases/:caseNo/return {"reason"} → 200 {"status":"NEED_FIX","returnCount"}
  app.post('/api/officer/cases/:caseNo/return', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      if (!isHolder(user, c)) throw new AppError('FORBIDDEN');
      if (c.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
      const n = Number(c.return_count || 0);
      if (n >= RETURN_MAX && !bugMode('B12')) throw new AppError('RETURN_LIMIT'); // B12: third return allowed
      const reason = reasonOf(req.body);
      if (chars(reason) < REASON_MIN) throw new AppError('REASON_TOO_SHORT');
      const nowD = clock.now();
      const now = time.toIso(nowD);
      const deadline = time.toIso(time.addHours(nowD, FIX_WINDOW_HOURS));
      db.prepare(`UPDATE cases SET status = 'NEED_FIX', return_count = ?, returned_at = ?, fix_deadline = ?, updated_at = ?
        WHERE id = ?`).run(n + 1, now, deadline, now, c.id);
      db.prepare(`INSERT OR REPLACE INTO case_returns(case_id, n, returned_at, returned_by, reason, resubmitted_at, paused_days)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run(c.id, n + 1, now, user.username, reason);
      event(c.id, user.username, 'IN_REVIEW', 'NEED_FIX', reason, now);
      audit.log({ user, event: 'RETURN', caseNo: c.case_no, fromStatus: 'IN_REVIEW', toStatus: 'NEED_FIX', detail: reason });
      return { status: 'NEED_FIX', returnCount: n + 1, fixDeadline: deadline };
    })();
    res.json(out);
  });

  // POST /api/officer/cases/:caseNo/forward {"note"} → {"status":"IN_REVIEW","step":2} | {"status":"PENDING_APPROVAL"}
  app.post('/api/officer/cases/:caseNo/forward', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      if (!isHolder(user, c)) throw new AppError('FORBIDDEN');
      if (c.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
      const route = routeOf(c);
      const cur = currentDept(c);
      const idx = route.indexOf(cur);
      const next = idx >= 0 ? route[idx + 1] : null;
      if (!next) throw new AppError('INVALID_STATE'); // SV-01: no next step (officer decides)
      const note = str(req.body && req.body.note).trim();
      const now = clock.nowIso();
      leaveHandler(c.id, cur, now);
      let result;
      if (next === 'head') {
        const head = headUsername();
        const step = c.service_id === 'SV-03' ? route.length : null; // SV-03 → 3
        db.prepare(`UPDATE cases SET status = 'PENDING_APPROVAL', dept = NULL, owner = ?, step = ?, updated_at = ? WHERE id = ?`)
          .run(head, step, now, c.id);
        enterHandler(c.id, 'head', head, now);
        result = { status: 'PENDING_APPROVAL' };
        if (step != null) result.step = step;
      } else {
        const step = idx + 2; // SV-03 registry(1) → works(2)
        db.prepare(`UPDATE cases SET status = 'IN_REVIEW', dept = ?, owner = NULL, step = ?, updated_at = ? WHERE id = ?`)
          .run(next, c.service_id === 'SV-03' ? step : c.step, now, c.id);
        enterHandler(c.id, next, null, now);
        result = { status: 'IN_REVIEW', step };
      }
      event(c.id, user.username, 'IN_REVIEW', result.status,
        `ส่งต่อ → ${labels.DEPT_TH[next] || next}${note ? ' · ' + note : ''}`, now);
      audit.log({ user, event: 'FORWARD', caseNo: c.case_no, fromStatus: 'IN_REVIEW', toStatus: result.status, detail: note });
      return result;
    })();
    res.json(out);
  });

  // POST /api/cases/:caseNo/approve → 200 {"status":"APPROVED"} (central guard: officer · head)
  app.post('/api/cases/:caseNo/approve', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      checkDecision(user, c, 'approve');
      const now = clock.nowIso();
      const issuer = c.approver === 'officer' ? user.username : issuerOf(c) || user.username;
      leaveHandler(c.id, currentDept(c), now);
      db.prepare(`UPDATE cases SET status = 'APPROVED', approved_by = ?, approved_at = ?, issuer = ?, owner = NULL,
          dept = 'registry', updated_at = ? WHERE id = ?`).run(user.username, now, issuer, now, c.id);
      event(c.id, user.username, c.status, 'APPROVED', 'อนุมัติ', now);
      audit.log({ user, event: 'APPROVE', caseNo: c.case_no, fromStatus: c.status, toStatus: 'APPROVED' });
      return { status: 'APPROVED' };
    })();
    res.json(out);
  });

  // POST /api/cases/:caseNo/reject {"reason"} → 200 {"status":"REJECTED","closedAt"}
  app.post('/api/cases/:caseNo/reject', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      checkDecision(user, c, 'reject');
      const reason = reasonOf(req.body);
      if (chars(reason) < REASON_MIN) throw new AppError('REASON_TOO_SHORT');
      const now = clock.nowIso();
      leaveHandler(c.id, currentDept(c), now);
      db.prepare(`UPDATE cases SET status = 'REJECTED', closed_at = ?, reject_reason = ?, owner = NULL, dept = NULL,
          updated_at = ? WHERE id = ?`).run(now, reason, now, c.id);
      event(c.id, user.username, c.status, 'REJECTED', reason, now);
      audit.log({ user, event: 'REJECT', caseNo: c.case_no, fromStatus: c.status, toStatus: 'REJECTED', detail: reason });
      return { status: 'REJECTED', closedAt: now };
    })();
    res.json(out);
  });

  // POST /api/officer/cases/:caseNo/issue → 200 {"docNo","verifyCode","status":"COMPLETED"} (issuer A-27 only)
  app.post('/api/officer/cases/:caseNo/issue', (req, res) => {
    const user = req.user;
    const out = db.transaction(() => {
      const c = mustCase(req.params.caseNo);
      if (user.role !== 'officer' || issuerOf(c) !== user.username) throw new AppError('FORBIDDEN');
      if (c.status !== 'APPROVED') throw new AppError('INVALID_STATE');
      const nowD = clock.now();
      const now = time.toIso(nowD);
      const doc = createDocument(c, user.username, nowD);
      db.prepare(`UPDATE cases SET status = 'COMPLETED', closed_at = ?, doc_no = ?, owner = NULL, dept = NULL, updated_at = ?
        WHERE id = ?`).run(now, doc.docNo, now, c.id);
      event(c.id, user.username, 'APPROVED', 'COMPLETED', `ออกเอกสาร ${doc.docNo}`, now);
      audit.log({ user, event: 'ISSUE', caseNo: c.case_no, fromStatus: 'APPROVED', toStatus: 'COMPLETED', detail: doc.docNo });
      return { docNo: doc.docNo, verifyCode: doc.verifyCode, status: 'COMPLETED' };
    })();
    res.json(out);
  });

  // POST /api/officer/cases/:caseNo/unmask {"reason"} → 200 {"idNo"} + Audit UNMASK (B11: no audit)
  app.post('/api/officer/cases/:caseNo/unmask', (req, res) => {
    const user = req.user;
    const c = mustCase(req.params.caseNo);
    if (!staffCanAccess(user, c)) throw new AppError('FORBIDDEN');
    const reason = reasonOf(req.body);
    if (!reason) throw new AppError('REASON_REQUIRED');
    const idNo = idNoOf(c);
    if (!bugMode('B11')) audit.log({ user, event: 'UNMASK', caseNo: c.case_no, detail: reason });
    res.json({ idNo });
  });

  // GET /api/cases/:caseNo — staff view (citizen view normally answered by payments.js; fallback here, B06-aware)
  app.get('/api/cases/:caseNo', (req, res) => {
    const c = mustCase(req.params.caseNo);
    if (req.user.role === 'citizen') {
      if (!ctx.auth || !ctx.auth.citizenCanView(req, c)) throw new AppError('NOT_FOUND');
      return res.json(caseJson(c, req.user));
    }
    if (!staffCanAccess(req.user, c)) throw new AppError('FORBIDDEN');
    res.json(caseJson(c, req.user));
  });

  // GET /api/cases/:caseNo/files (BR-29) · citizen ownership already enforced centrally (404)
  app.get('/api/cases/:caseNo/files', (req, res) => {
    const c = mustCase(req.params.caseNo);
    if (req.user.role === 'citizen') {
      if (!ctx.auth || !ctx.auth.citizenOwns(req, c)) throw new AppError('NOT_FOUND');
    } else if (!staffCanAccess(req.user, c)) throw new AppError('FORBIDDEN');
    const items = db.prepare('SELECT id, name, doc_key, size FROM files WHERE case_id = ? AND deleted = 0 ORDER BY created_at, id')
      .all(c.id).map((f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size }));
    res.json({ items });
  });

  // GET /api/files/:fileId (BR-29) · nonexistent → 404 · out of scope → 403
  app.get('/api/files/:fileId', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ? AND deleted = 0').get(str(req.params.fileId));
    if (!f) throw new AppError('NOT_FOUND');
    const c = db.prepare(`${CASE_SQL} WHERE c.id = ? AND c.deleted = 0`).get(f.case_id);
    if (!c) throw new AppError('NOT_FOUND');
    if (req.user.role === 'citizen') {
      if (!ctx.auth || !ctx.auth.citizenOwns(req, c)) throw new AppError('NOT_FOUND');
    } else if (!c.case_no || !staffCanAccess(req.user, c)) throw new AppError('FORBIDDEN');
    const safeName = str(f.name).replace(/[^\w.\-]/g, '_') || 'file';
    res.set('Content-Type', f.mime);
    res.set('Content-Length', String(f.data.length));
    res.set('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.set('Cache-Control', 'no-store');
    res.end(f.data);
  });

  // ─────────────────────────── pages ───────────────────────────
  function rowView(c, hol) {
    return {
      caseNo: c.case_no, serviceId: c.service_id, serviceName: c.service_name, applicantName: c.applicant_name,
      idMasked: mask.maskId(idNoOf(c)), status: c.status, owner: c.owner || '', dueAt: c.due_at,
      level: levelOf(c, hol), step: c.step, dept: currentDept(c),
    };
  }

  // /officer/queue (officer · head read-only; central page guard)
  app.get('/officer/queue', (req, res) => {
    const user = req.user;
    const filter = normFilter(req.query.filter);
    const hol = rules.loadHolidays(db);
    const rows = queueFor(user, filter).map((c) => ({ ...rowView(c, hol), claimable: canClaim(user, c) }));
    res.render('officer-queue', {
      title: 'คิวงาน', filter, rows,
      workload: user.role === 'officer' ? workload(user.username) : null,
      deptName: user.role === 'head' ? 'ทุกแผนก' : labels.DEPT_TH[user.dept] || user.dept,
    });
  });

  // /head/approvals (head)
  app.get('/head/approvals', (req, res) => {
    const hol = rules.loadHolidays(db);
    res.render('head-approvals', { title: 'รายการรออนุมัติ', rows: approvalsList().map((c) => rowView(c, hol)) });
  });

  // /officer/cases/:caseNo (officer · head) · no such number → 404 · officer out of scope → 403
  app.get('/officer/cases/:caseNo', async (req, res, next) => {
    try {
      const user = req.user;
      const c = loadCase(req.params.caseNo);
      if (!c) return guard.renderNotFound(req, res);
      if (!staffCanAccess(user, c)) return guard.renderForbidden(req, res);
      const hol = rules.loadHolidays(db);
      const files = db.prepare('SELECT id, name, doc_key, size, mime FROM files WHERE case_id = ? AND deleted = 0 ORDER BY created_at, id').all(c.id);
      const events = db.prepare('SELECT * FROM case_events WHERE case_id = ? ORDER BY time, id').all(c.id);
      const doc = docOf(c);
      let verifyUrl = null;
      let qrDataUrl = null;
      if (doc) {
        verifyUrl = `${req.protocol}://${req.get('host')}/verify/${doc.verify_code}`;
        try { qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 160 }); } catch (e) { qrDataUrl = null; }
      }
      const lastReturn = c.status === 'NEED_FIX'
        ? db.prepare('SELECT * FROM case_returns WHERE case_id = ? ORDER BY n DESC LIMIT 1').get(c.id) : null;
      res.render('officer-case', {
        title: `คำขอ ${c.case_no}`,
        c,
        v: {
          caseNo: c.case_no, status: c.status, serviceId: c.service_id, serviceName: c.service_name,
          stepLabel: c.service_id === 'SV-03' ? STEP_LABEL[Number(c.step) || 1] : null,
          fee: c.fee, applicantName: c.applicant_name, idMasked: mask.maskId(idNoOf(c)),
          dueAt: c.due_at, level: levelOf(c, hol), closedAt: ['COMPLETED', 'REJECTED'].includes(c.status) ? c.closed_at : null,
          owner: c.owner || '', returnCount: Number(c.return_count || 0), rejectReason: c.reject_reason,
          fixDeadline: c.status === 'NEED_FIX' ? c.fix_deadline : null, lastReturn,
          docNo: doc ? doc.doc_no : null, verifyCode: doc ? doc.verify_code : null, verifyUrl, qrDataUrl,
          issuer: issuerOf(c), approvedBy: c.approved_by,
        },
        files, events,
        can: {
          claim: canClaim(user, c),
          ret: canReturnUi(user, c),
          forward: canForwardUi(user, c),
          decide: canDecideUi(user, c),
          issue: canIssueUi(user, c),
          unmask: user.role === 'officer' || user.role === 'head',
        },
      });
    } catch (e) { next(e); }
  });

  ctx.officer = { caseJson, loadCase, currentDept, staffCanAccess, workload, computeValidUntil, queueFor };
};
