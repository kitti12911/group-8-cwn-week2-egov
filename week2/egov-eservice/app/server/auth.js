'use strict';
// B04 · Auth + register + RBAC
//   FR-01 citizen ThaiD (mock) 13-digit ID + OTP · BR-01 checksum · BR-02 lock 3 fails / 15 min
//   FR-02 first-visit register (BR-03) · FR-03 staff SSO (mock) username + password
//   CONTRACT §1 route RBAC (central prefix guards, registered BEFORE every other module)
//   BR-22 citizen ownership: someone else's case / draft / document / file / payment → 404 "ไม่พบคำขอ"
//   BUG_MODE B06: citizen can VIEW someone else's case (GET /citizen/cases/:no, GET /api/cases/:no) — IDOR
//
// Exposes ctx.auth = { citizenCanView(req, caseRow), citizenOwns(req, caseRow), isCaseVisibleToCitizen }
// so feature blocks that load the case themselves can apply the same rule (incl. B06).

const OTP_MAX_FAILS = 3;
const LOCK_MINUTES = 15;

module.exports = function register(app, ctx) {
  const { db, clock, time, crypto, mask, errors, guard, sessions, audit, bugMode, config } = ctx;
  const { AppError, sendError } = errors;

  // ─────────────────────────── helpers ───────────────────────────
  const str = (v) => (v == null ? '' : String(v));
  const nowMs = () => clock.now().getTime();

  /** OTP state with automatic unlock: once locked_until has passed, counter restarts at 0 (BR-02). */
  function otpState(idHash) {
    let row = db.prepare('SELECT * FROM otp_state WHERE id_hash = ?').get(idHash);
    if (!row) return { id_hash: idHash, fail_count: 0, locked_until: null, exists: false };
    if (row.locked_until && nowMs() >= time.toDate(row.locked_until).getTime()) {
      db.prepare('UPDATE otp_state SET fail_count = 0, locked_until = NULL WHERE id_hash = ?').run(idHash);
      row = { ...row, fail_count: 0, locked_until: null };
    }
    return { ...row, exists: true };
  }
  const isLocked = (st) => !!(st.locked_until && nowMs() < time.toDate(st.locked_until).getTime());

  function saveOtp(idHash, fields) {
    db.prepare(`INSERT INTO otp_state(id_hash, fail_count, locked_until, otp_sent_at)
                VALUES (@id_hash, @fail_count, @locked_until, @otp_sent_at)
                ON CONFLICT(id_hash) DO UPDATE SET fail_count = excluded.fail_count,
                  locked_until = excluded.locked_until,
                  otp_sent_at = COALESCE(excluded.otp_sent_at, otp_state.otp_sent_at)`)
      .run({ id_hash: idHash, fail_count: 0, locked_until: null, otp_sent_at: null, ...fields });
  }

  function validId(raw) {
    const idNo = str(raw).trim();
    if (!mask.isValidThaiId(idNo)) throw new AppError('INVALID_ID');
    return idNo;
  }

  function citizenByHash(idHash) {
    return db.prepare('SELECT * FROM citizens WHERE id_hash = ?').get(idHash);
  }

  /** ThaiD mock: unknown (but checksum-valid) ID → create an unregistered citizen with a mock name. */
  function ensureCitizen(idNo, idHash) {
    let c = citizenByHash(idHash);
    if (c) return c;
    const now = clock.nowIso();
    db.prepare(`INSERT INTO citizens(id_hash, id_enc, first_name, last_name, full_name, registered, created_at)
                VALUES (?, ?, 'ประชาชน', 'ทดสอบ', 'ประชาชน ทดสอบ', 0, ?)`)
      .run(idHash, crypto.encrypt(idNo), now);
    c = citizenByHash(idHash);
    return c;
  }

  function citizenSession(c) {
    return {
      type: 'citizen', id: c.id, username: String(c.id), name: c.full_name,
      role: 'citizen', dept: '', ...(c.registered ? {} : { scope: 'register' }),
    };
  }

  // ─────────────────────── ownership (BR-22 / B06) ───────────────────────
  /** citizen owns the case row (cases.citizen_id) */
  function citizenOwns(req, row) {
    return !!(row && req.user && req.user.role === 'citizen' && Number(row.citizen_id) === Number(req.user.id));
  }
  /** citizen may VIEW the case (page / GET API). B06 = IDOR: any existing case is viewable. */
  function citizenCanView(req, row) {
    if (!row) return false;
    return citizenOwns(req, row) || bugMode('B06');
  }
  ctx.auth = { citizenOwns, citizenCanView, OTP_MAX_FAILS, LOCK_MINUTES };

  const caseByNo = (no) => db.prepare('SELECT id, citizen_id, case_no FROM cases WHERE case_no = ? AND deleted = 0').get(str(no));
  const caseByDraft = (id) => db.prepare('SELECT id, citizen_id, draft_id FROM cases WHERE draft_id = ? AND deleted = 0').get(str(id));
  const caseById = (id) => db.prepare('SELECT id, citizen_id, case_no FROM cases WHERE id = ? AND deleted = 0').get(id);
  const caseOfDoc = (docNo) => {
    const d = db.prepare('SELECT case_id FROM documents WHERE doc_no = ?').get(str(docNo));
    return d ? caseById(d.case_id) : null;
  };
  const caseOfFile = (fileId) => {
    const f = db.prepare('SELECT case_id FROM files WHERE id = ? AND deleted = 0').get(str(fileId));
    return f ? caseById(f.case_id) : null;
  };
  const caseOfPayment = (ref) => {
    const p = db.prepare('SELECT case_id FROM payments WHERE ref = ?').get(str(ref));
    return p ? caseById(p.case_id) : null;
  };

  /** B06 scope = only viewing the case itself (GET/HEAD on the exact path), never cancel/resubmit/files */
  const isViewOnly = (req) => (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/' || req.path === '');

  /** middleware factory: for citizens, 404 unless they own the resource (view=true → B06 applies) */
  function citizenOwnership(loader, { view = false, page = false } = {}) {
    return (req, res, next) => {
      if (!req.user || req.user.role !== 'citizen') return next();
      const row = loader(req);
      const ok = view ? citizenCanView(req, row) : citizenOwns(req, row);
      if (ok) { req.ownedCase = row; return next(); }
      return page ? guard.renderNotFound(req, res) : sendError(res, 'NOT_FOUND');
    };
  }

  // ─────────────────────── central RBAC (CONTRACT §1 / §6) ───────────────────────
  // Pages: not logged in → 302 /login · wrong role → 403 forbidden-msg
  app.use('/citizen', guard.page('citizen'));
  app.use('/officer', guard.page('officer', 'head'));
  app.use('/head', guard.page('head'));
  app.use('/dashboard', guard.page('executive'));
  app.use('/audit', guard.page('auditor'));
  app.use('/admin', guard.page('admin'));
  app.use('/notifications', guard.page('officer', 'head'));

  // citizen case page: someone else's / nonexistent → 404 not-found-msg (B06 opens it for viewing)
  app.use('/citizen/cases/:caseNo', (req, res, next) =>
    citizenOwnership(() => caseByNo(req.params.caseNo), { view: isViewOnly(req), page: true })(req, res, next));
  // resume someone else's draft → 404
  app.use('/citizen/new/:service', (req, res, next) => {
    if (!req.query.draft) return next();
    return citizenOwnership(() => caseByDraft(req.query.draft), { page: true })(req, res, next);
  });

  // API: not logged in → 401 UNAUTHENTICATED · wrong role → 403 FORBIDDEN
  // Audit Trail is append-only for EVERY role (incl. admin / anonymous) → 405 (BR-27)
  app.use('/api/audit', (req, res, next) => {
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) return sendError(res, 'METHOD_NOT_ALLOWED');
    next();
  });
  app.use('/api/audit', guard.api('auditor'));
  app.use('/api/officer', guard.api('officer', 'head'));
  app.use('/api/notifications', guard.api('officer', 'head'));
  app.use('/api/dashboard', guard.api('executive'));
  app.use('/api/admin', guard.api('admin'));
  app.use('/api/drafts', guard.api('citizen'));
  app.use('/api/payments', guard.api('citizen'));
  app.use('/api/documents', guard.api('citizen', 'officer', 'head'));
  app.use('/api/files', guard.api('citizen', 'officer', 'head'));

  app.get('/api/cases', guard.api('citizen')); // my cases list (exact path)
  app.use('/api/cases/:caseNo/cancel', guard.api('citizen'));
  app.use('/api/cases/:caseNo/resubmit', guard.api('citizen'));
  app.use('/api/cases/:caseNo/approve', guard.api('officer', 'head'));
  app.use('/api/cases/:caseNo/reject', guard.api('officer', 'head'));
  app.use('/api/cases/:caseNo', guard.api('citizen', 'officer', 'head'));

  // citizen ownership on APIs (identical 404 body for "not yours" and "does not exist")
  app.use('/api/cases/:caseNo', (req, res, next) =>
    citizenOwnership(() => caseByNo(req.params.caseNo), { view: isViewOnly(req) })(req, res, next));
  app.use('/api/drafts/:draftId', citizenOwnership((req) => caseByDraft(req.params.draftId)));
  app.use('/api/documents/:docNo', citizenOwnership((req) => caseOfDoc(req.params.docNo)));
  app.use('/api/files/:fileId', citizenOwnership((req) => caseOfFile(req.params.fileId)));
  app.use('/api/payments/:ref', citizenOwnership((req) => caseOfPayment(req.params.ref)));

  // ─────────────────────── pages: /login /register ───────────────────────
  app.get('/login', (req, res) => {
    res.render('login', { title: 'เข้าสู่ระบบ', tab: req.query.tab === 'staff' ? 'staff' : 'citizen' });
  });

  app.get('/register', (req, res) => {
    if (req.user) return res.redirect(guard.landingFor(req.user));
    if (!req.session || req.session.scope !== 'register') return res.redirect('/login');
    const c = db.prepare('SELECT full_name, email, registered FROM citizens WHERE id = ?').get(req.session.id);
    if (!c) { sessions.destroy(req, res); return res.redirect('/login'); }
    res.render('register', { title: 'ลงทะเบียน', citizenName: c.full_name });
  });

  // ─────────────────────── API §6.1 ───────────────────────
  // POST /api/auth/thaid/start {"idNo"} → 200 {"status":"OTP_SENT"} · 400 INVALID_ID · 423 LOCKED
  app.post('/api/auth/thaid/start', (req, res) => {
    const idNo = validId(req.body && req.body.idNo);
    const h = crypto.hashId(idNo);
    const st = otpState(h);
    if (isLocked(st)) throw new AppError('LOCKED', { lockedUntil: st.locked_until });
    saveOtp(h, { fail_count: st.fail_count, locked_until: null, otp_sent_at: clock.nowIso() });
    res.status(200).json({ status: 'OTP_SENT' });
  });

  // POST /api/auth/thaid/verify {"idNo","otp"} → 200 {"registered"} + cookie · 401 OTP_INVALID {attemptsLeft} · 423 LOCKED {lockedUntil}
  app.post('/api/auth/thaid/verify', (req, res) => {
    const idNo = validId(req.body && req.body.idNo);
    const otp = str(req.body && req.body.otp).trim();
    const h = crypto.hashId(idNo);

    const outcome = db.transaction(() => {
      const st = otpState(h);
      if (isLocked(st)) return { locked: st.locked_until };
      if (otp !== config.OTP_TEST) {
        const fails = st.fail_count + 1;
        if (fails >= OTP_MAX_FAILS) {
          const until = time.toIso(new Date(nowMs() + LOCK_MINUTES * 60 * 1000));
          saveOtp(h, { fail_count: fails, locked_until: until });
          return { locked: until };
        }
        saveOtp(h, { fail_count: fails, locked_until: null });
        return { attemptsLeft: OTP_MAX_FAILS - fails };
      }
      saveOtp(h, { fail_count: 0, locked_until: null }); // correct OTP resets the counter
      return { ok: true, citizen: ensureCitizen(idNo, h) };
    })();

    if (outcome.locked) throw new AppError('LOCKED', { lockedUntil: outcome.locked });
    if (!outcome.ok) throw new AppError('OTP_INVALID', { attemptsLeft: outcome.attemptsLeft });

    sessions.destroy(req, res);
    const c = outcome.citizen;
    sessions.create(res, citizenSession(c));
    const registered = !!c.registered;
    res.status(200).json({ registered, landing: registered ? '/citizen' : '/register' });
  });

  // POST /api/auth/register {"mobile","email","consent"} → 201 · 400 INVALID_MOBILE · 400 CONSENT_REQUIRED
  app.post('/api/auth/register', (req, res) => {
    if (req.user) {
      if (req.user.role === 'citizen') throw new AppError('INVALID_STATE'); // already registered
      throw new AppError('FORBIDDEN');
    }
    if (!req.session || req.session.scope !== 'register') throw new AppError('UNAUTHENTICATED');
    const b = req.body || {};
    const mobile = str(b.mobile).trim();
    const email = str(b.email).trim().slice(0, 200);
    const consent = b.consent === true || b.consent === 'true' || b.consent === 'on' || b.consent === 1 || b.consent === '1';
    if (!/^0\d{9}$/.test(mobile)) throw new AppError('INVALID_MOBILE');
    if (!consent) throw new AppError('CONSENT_REQUIRED');

    const c = db.prepare('SELECT * FROM citizens WHERE id = ?').get(req.session.id);
    if (!c) throw new AppError('UNAUTHENTICATED');
    if (c.registered) throw new AppError('INVALID_STATE');
    const now = clock.nowIso();
    db.prepare(`UPDATE citizens SET mobile_enc = ?, email = ?, registered = 1, consent_at = ?, registered_at = ?
                WHERE id = ?`).run(crypto.encrypt(mobile), email, now, now, c.id);
    sessions.update(req, { scope: null });
    res.status(201).json({ registered: true, landing: '/citizen' });
  });

  // POST /api/auth/staff/login {"username","password"} → 200 {role,dept,landing} · 401 INVALID_CREDENTIALS
  app.post('/api/auth/staff/login', (req, res) => {
    const b = req.body || {};
    const username = str(b.username).trim();
    const password = str(b.password);
    const s = username ? db.prepare('SELECT * FROM staff WHERE username = ? AND active = 1').get(username) : null;
    if (!s || !crypto.verifyPassword(s.username, password, s.password_hash)) throw new AppError('INVALID_CREDENTIALS');

    sessions.destroy(req, res);
    const data = { type: 'staff', id: s.id, username: s.username, name: s.name, role: s.role, dept: s.dept || '' };
    sessions.create(res, data);
    audit.log({ username: s.username, role: s.role, event: 'STAFF_LOGIN' });
    const landing = guard.landingFor(data);
    res.status(200).json({ role: s.role, dept: s.dept || '', landing });
  });

  // POST /api/auth/logout → 204
  app.post('/api/auth/logout', (req, res) => {
    sessions.destroy(req, res);
    res.status(204).end();
  });
  app.get('/logout', (req, res) => { sessions.destroy(req, res); res.redirect('/login'); });

  // GET /api/me → 200 {username,name,role,dept} · 401
  app.get('/api/me', guard.api(), (req, res) => {
    const u = req.user;
    res.json({ username: u.username, name: u.name, role: u.role, dept: u.dept || '', landing: guard.landingFor(u) });
  });
};
