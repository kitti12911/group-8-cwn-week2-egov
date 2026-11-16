'use strict';
// B06 · PromptPay QR (mock) · case number · receipt · my cases · cancel · resubmit · auto-cancel
//   FR-08 BR-09 BR-10 BR-11 · FR-09 · FR-10 BR-22 A-13 A-62 · FR-11 BR-20 A-21 A-29 A-46 · DECISIONS §5–§7
//   BUG_MODE B05: QR aged exactly 15:00 is still payable (uses ≤ instead of <)
//
// Owns:  API  POST /api/drafts/:draftId/payment → 201 {ref,amount,status,qrCreatedAt,qrExpiresAt}
//             GET  /api/payments/:ref → {ref,draftId,amount,status PENDING|PAID|EXPIRED,qrCreatedAt,qrExpiresAt,caseNo,receiptNo,paidAt,paidAmount}
//             GET  /api/cases (my numbered cases) · POST /api/cases/:caseNo/cancel · POST /api/cases/:caseNo/resubmit
//        hook POST /api/test/payments/:ref/pay {"amount"} (TEST_MODE only)
//        page GET /citizen (my cases + drafts) · GET /citizen/cases/:caseNo (citizen case page + timeline)
//        onRequest: auto-cancel NEED_FIX once now ≥ fix_deadline (timeline time = returned_at + 168 h)
// NOT here: GET /api/cases/:caseNo JSON (officer.js answers staff AND citizen, B06-aware) · documents PDF (B08).
// Central RBAC / ownership (auth.js) already ran before these routes (citizen only · not mine → 404).
//
// Concurrency: better-sqlite3 is synchronous and every handler body runs inside one db.transaction
// → two simultaneous callbacks can never get the same case/receipt number; cancel vs claim: one wins (A-62).

const QRCode = require('qrcode');
const rules = require('./rules');

const QR_TTL_MS = 15 * 60 * 1000; // BR-10: payable while age < 15:00
const STEP_LABEL = { 1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน', 2: 'ขั้นตอน 2/3 · ฝ่ายโยธา', 3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย' };
const NO_REFUND = 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน';
const PAY_TH = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' };

module.exports = function register(app, ctx) {
  const { db, clock, time, nextNumber, errors, guard, upload, bugMode, hooks, labels, crypto, mask } = ctx;
  const { AppError } = errors;
  const str = (v) => (v == null ? '' : String(v));
  const pad = (n, w) => String(n).padStart(w, '0');
  const ms = (v) => time.toDate(v).getTime();

  // ─────────────────────────── helpers ───────────────────────────
  const CASE_SQL = `SELECT c.*, s.name AS service_name, s.sla AS service_sla,
      z.full_name AS applicant_name, z.id_enc AS applicant_id_enc
    FROM cases c JOIN services s ON s.id = c.service_id JOIN citizens z ON z.id = c.citizen_id`;
  const caseByNo = (no) => db.prepare(`${CASE_SQL} WHERE c.case_no = ? AND c.deleted = 0`).get(str(no)) || null;
  const caseById = (id) => db.prepare(`${CASE_SQL} WHERE c.id = ?`).get(id) || null;

  function event(caseId, actor, from, to, note, at) {
    db.prepare('INSERT INTO case_events(case_id, time, actor, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(caseId, at, actor, from || null, to || null, note || '');
  }

  /** BR-10: expired when age ≥ 15:00 · B05: only when age > 15:00 */
  function qrExpired(p, nowD) {
    const age = nowD.getTime() - ms(p.qr_created_at);
    return bugMode('B05') ? age > QR_TTL_MS : age >= QR_TTL_MS;
  }

  /** API status of a payment row at time now (VOID = replaced by a newer QR → shown as EXPIRED) */
  function payStatus(p, nowD) {
    if (p.status === 'PAID') return 'PAID';
    if (p.status === 'VOID' || p.status === 'EXPIRED') return 'EXPIRED';
    return qrExpired(p, nowD) ? 'EXPIRED' : 'PENDING';
  }

  function paymentJson(p, c, nowD) {
    const status = payStatus(p, nowD);
    const paid = status === 'PAID';
    return {
      ref: p.ref, draftId: c ? c.draft_id : null, amount: p.amount, status,
      qrCreatedAt: time.toIso(p.qr_created_at), qrExpiresAt: time.toIso(p.qr_expires_at),
      caseNo: paid && c ? c.case_no : null, receiptNo: paid && c ? c.receipt_no : null,
      paidAt: paid ? time.toIso(p.paid_at) : null, paidAmount: paid ? p.paid_amount : null,
    };
  }

  const holidays = () => rules.loadHolidays(db);
  const levelOf = (c, hol) => rules.slaLevel({ status: c.status, dueAt: c.due_at }, clock.now(), hol || holidays());
  const idNoOf = (c) => { try { return crypto.decrypt(c.applicant_id_enc); } catch (e) { return ''; } };

  // ─────────────────────────── auto-cancel (BR-20 / A-46) ───────────────────────────
  // evaluated on every request; cancel time on the timeline = fix deadline (returned_at + 168 h)
  function autoCancel(nowD) {
    const now = nowD.getTime();
    const due = db.prepare(`SELECT id, fix_deadline FROM cases WHERE status = 'NEED_FIX' AND deleted = 0
      AND fix_deadline IS NOT NULL`).all().filter((r) => ms(r.fix_deadline) <= now);
    if (!due.length) return 0;
    db.transaction(() => {
      for (const r of due) {
        const at = time.toIso(r.fix_deadline);
        const ch = db.prepare(`UPDATE cases SET status = 'CANCELLED', cancelled_at = ?, dept = NULL, updated_at = ?
          WHERE id = ? AND status = 'NEED_FIX'`).run(at, at, r.id);
        if (ch.changes) {
          db.prepare('UPDATE case_handlers SET left_at = ? WHERE case_id = ? AND left_at IS NULL').run(at, r.id);
          event(r.id, 'system', 'NEED_FIX', 'CANCELLED', 'หมดเวลาแก้ไข ระบบยกเลิกอัตโนมัติ', at);
        }
      }
    })();
    return due.length;
  }
  hooks.onRequest(() => autoCancel(clock.now()));

  // ─────────────────────────── payment (FR-08) ───────────────────────────
  // POST /api/drafts/:draftId/payment → 201 new QR (new ref every time · amount = fee locked at PENDING_PAYMENT)
  app.post('/api/drafts/:draftId/payment', guard.api('citizen'), (req, res) => {
    const out = db.transaction(() => {
      const c = db.prepare('SELECT * FROM cases WHERE draft_id = ? AND citizen_id = ? AND deleted = 0')
        .get(str(req.params.draftId), req.user.id);
      if (!c) throw new AppError('NOT_FOUND');
      if (c.case_no || (c.status !== 'DRAFT' && c.status !== 'PENDING_PAYMENT')) throw new AppError('INVALID_STATE');
      if (ctx.apply && ctx.apply.assertDocsComplete) ctx.apply.assertDocsComplete(c); // 409 MISSING_DOCS {missing}
      const nowD = clock.now();
      const now = time.toIso(nowD);
      let amount = c.fee;
      if (c.status === 'DRAFT') { // A-42: lock the CURRENT price when entering PENDING_PAYMENT
        amount = ctx.apply && ctx.apply.currentFee ? ctx.apply.currentFee(c) : c.fee;
        if (amount == null) throw new AppError('INVALID_STATE');
        db.prepare(`UPDATE cases SET status = 'PENDING_PAYMENT', fee = ?, fee_locked_at = ?, updated_at = ? WHERE id = ?`)
          .run(amount, now, now, c.id);
      }
      // a regenerated QR replaces older unpaid ones (they answer EXPIRED / 410 from now on)
      db.prepare("UPDATE payments SET status = 'VOID' WHERE case_id = ? AND status = 'PENDING'").run(c.id);
      const ref = `PP-${pad(nextNumber('payment', 0), 4)}`;
      const expires = time.toIso(time.addMs(nowD, QR_TTL_MS));
      db.prepare(`INSERT INTO payments(ref, case_id, amount, status, qr_created_at, qr_expires_at)
        VALUES (?, ?, ?, 'PENDING', ?, ?)`).run(ref, c.id, amount, now, expires);
      return { ref, draftId: c.draft_id, amount, status: 'PENDING', qrCreatedAt: now, qrExpiresAt: expires };
    })();
    res.status(201).json(out);
  });

  // GET /api/payments/:ref (citizen owner; unknown / deleted draft → 404)
  app.get('/api/payments/:ref', guard.api('citizen'), (req, res) => {
    const p = db.prepare('SELECT * FROM payments WHERE ref = ?').get(str(req.params.ref));
    const c = p ? caseById(p.case_id) : null;
    if (!p || !c || c.deleted || Number(c.citizen_id) !== Number(req.user.id)) throw new AppError('NOT_FOUND');
    res.json(paymentJson(p, c, clock.now()));
  });

  /** mock bank callback (body is exactly {status,caseNo,receiptNo,duplicate}; paidAt via GET /api/payments/:ref): idempotent per ref · 410 QR_EXPIRED · 422 AMOUNT_MISMATCH · 404 unknown ref */
  function pay(ref, body) {
    return db.transaction(() => {
      const p = db.prepare('SELECT * FROM payments WHERE ref = ?').get(str(ref));
      const c = p ? caseById(p.case_id) : null;
      if (!p || !c || c.deleted) throw new AppError('NOT_FOUND');
      if (p.status === 'PAID') { // BR-11: same ref again → same numbers, nothing new
        return { status: 'PAID', caseNo: c.case_no, receiptNo: c.receipt_no, duplicate: true };
      }
      const nowD = clock.now();
      if (p.status === 'VOID' || p.status === 'EXPIRED' || qrExpired(p, nowD)) throw new AppError('QR_EXPIRED');
      const amount = body && body.amount;
      if (typeof amount === 'boolean' || amount === null || amount === '' || Number(amount) !== Number(p.amount)) {
        throw new AppError('AMOUNT_MISMATCH');
      }
      if (c.case_no || c.status !== 'PENDING_PAYMENT') throw new AppError('INVALID_STATE');

      const now = time.toIso(nowD);
      const be = time.beYear(nowD); // BR-09: sequence restarts every BE year of the payment time
      const caseNo = `EG-${be}-${pad(nextNumber('case', be), 6)}`;
      const receiptNo = `RC-${be}-${pad(nextNumber('receipt', be), 6)}`;
      const dueAt = rules.computeDueAt(now, c.service_sla, holidays()); // BR-12: once, at payment
      db.prepare(`UPDATE cases SET status = 'SUBMITTED', case_no = ?, receipt_no = ?, paid_at = ?, due_at = ?,
          dept = 'registry', step = ?, owner = NULL, updated_at = ? WHERE id = ?`)
        .run(caseNo, receiptNo, now, dueAt, c.service_id === 'SV-03' ? 1 : null, now, c.id);
      db.prepare(`INSERT OR IGNORE INTO case_handlers(case_id, step, dept, username, entered_at, left_at)
        VALUES (?, 1, 'registry', NULL, ?, NULL)`).run(c.id, now);
      db.prepare("UPDATE payments SET status = 'PAID', paid_at = ?, paid_amount = ? WHERE ref = ?").run(now, p.amount, p.ref);
      db.prepare("UPDATE payments SET status = 'VOID' WHERE case_id = ? AND status = 'PENDING' AND ref <> ?").run(c.id, p.ref);
      event(c.id, 'system', 'PENDING_PAYMENT', 'SUBMITTED', `ชำระเงินสำเร็จ ${receiptNo}`, now);
      return { status: 'PAID', caseNo, receiptNo, duplicate: false }; // exact CONTRACT §8 body
    })();
  }

  if (ctx.testRouter) {
    ctx.testRouter.post('/payments/:ref/pay', (req, res) => res.json(pay(req.params.ref, req.body || {})));
  }
  ctx.payments = { pay, payStatus, qrExpired, autoCancel };

  // ─────────────────────────── my cases (FR-09) ───────────────────────────
  function myCases(citizenId) {
    return db.prepare(`${CASE_SQL} WHERE c.citizen_id = ? AND c.deleted = 0 AND c.case_no IS NOT NULL`).all(citizenId)
      .sort((a, b) => (a.case_no < b.case_no ? 1 : a.case_no > b.case_no ? -1 : 0)); // newest number first
  }
  function myDrafts(citizenId) {
    return db.prepare(`${CASE_SQL} WHERE c.citizen_id = ? AND c.deleted = 0 AND c.case_no IS NULL
      AND c.status IN ('DRAFT','PENDING_PAYMENT') ORDER BY c.draft_id`).all(citizenId);
  }

  // GET /api/cases → {items:[{caseNo,serviceId,status,dueAt,slaLevel}]} (mine, numbered only)
  app.get('/api/cases', guard.api('citizen'), (req, res) => {
    const hol = holidays();
    res.json({
      items: myCases(req.user.id).map((c) => ({
        caseNo: c.case_no, serviceId: c.service_id, status: c.status,
        step: c.service_id === 'SV-03' && c.step != null ? Number(c.step) : null,
        fee: c.fee, paidAt: c.paid_at || null, dueAt: c.due_at || null, slaLevel: levelOf(c, hol),
      })),
    });
  });

  // ─────────────────────────── cancel (FR-10 / BR-22 / A-62) ───────────────────────────
  app.post('/api/cases/:caseNo/cancel', guard.api('citizen'), (req, res) => {
    const out = db.transaction(() => {
      const c = caseByNo(req.params.caseNo);
      if (!c || Number(c.citizen_id) !== Number(req.user.id)) throw new AppError('NOT_FOUND');
      const now = clock.nowIso();
      const ch = db.prepare(`UPDATE cases SET status = 'CANCELLED', cancelled_at = ?, dept = NULL, updated_at = ?
        WHERE id = ? AND status = 'SUBMITTED' AND owner IS NULL`).run(now, now, c.id);
      if (!ch.changes) throw new AppError('CANNOT_CANCEL'); // claimed / later state → 409
      db.prepare('UPDATE case_handlers SET left_at = ? WHERE case_id = ? AND left_at IS NULL').run(now, c.id);
      event(c.id, 'citizen', 'SUBMITTED', 'CANCELLED', `ผู้ยื่นยกเลิกคำขอ · ${NO_REFUND}`, now);
      return { status: 'CANCELLED', caseNo: c.case_no, cancelledAt: now };
    })();
    res.json(out);
  });

  // ─────────────────────────── resubmit (FR-11 / BR-13 / BR-20 / A-29) ───────────────────────────
  /** optional new file (fix-upload-input) → validated like the wizard; returns null when none */
  function checkFixFile(req, c) {
    if (!req.file) return null;
    const docs = ctx.apply && ctx.apply.docsOf ? ctx.apply.docsOf(c.service_id) : [{ doc_key: 'extra', multiple: true }];
    const docKey = str(req.body && req.body.docKey).trim() || 'extra';
    const doc = docs.find((d) => d.doc_key === docKey);
    if (!doc) throw new AppError('BAD_REQUEST');
    const buf = req.file.buffer;
    const max = (ctx.apply && ctx.apply.MAX_FILE_BYTES) || 5 * 1024 * 1024;
    if (buf.length > max) throw new AppError('FILE_TOO_LARGE');
    const mime = upload.sniff(buf);
    if (!mime) throw new AppError('FILE_TYPE');
    if (doc.pdf_only && mime !== 'application/pdf') throw new AppError('PLAN_NOT_PDF');
    return { doc, docKey, buf, mime, name: fileName(req.file.originalname) };
  }
  function fileName(raw) {
    let n = str(raw) || 'file';
    try { const u = Buffer.from(n, 'latin1').toString('utf8'); if (!u.includes('�')) n = u; } catch (e) { /* keep */ }
    n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>]/g, '').trim();
    return (n || 'file').slice(0, 200);
  }
  function storeFixFile(c, f, now) {
    const maxFiles = (ctx.apply && ctx.apply.MAX_FILES) || 5;
    const files = db.prepare('SELECT id, doc_key FROM files WHERE case_id = ? AND deleted = 0').all(c.id);
    const replaced = f.doc.multiple ? [] : files.filter((x) => x.doc_key === f.docKey);
    if (files.length - replaced.length + 1 > maxFiles) throw new AppError('FILE_COUNT');
    for (const x of replaced) db.prepare('UPDATE files SET deleted = 1 WHERE id = ?').run(x.id);
    const id = `F-${pad(nextNumber('file', 0), 6)}`;
    db.prepare(`INSERT INTO files(id, case_id, doc_key, name, mime, size, data, created_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(id, c.id, f.docKey, f.name, f.mime, f.buf.length, f.buf, now);
    return { fileId: id, name: f.name, docKey: f.docKey, size: f.buf.length };
  }

  app.post('/api/cases/:caseNo/resubmit', guard.api('citizen'), upload.single('file'), (req, res) => {
    const nowD = clock.now();
    autoCancel(nowD); // deadline reached in this very request → cancelled first
    const out = db.transaction(() => {
      const c = caseByNo(req.params.caseNo);
      if (!c || Number(c.citizen_id) !== Number(req.user.id)) throw new AppError('NOT_FOUND');
      if (c.status === 'CANCELLED' && c.fix_deadline) throw new AppError('FIX_WINDOW_EXPIRED');
      if (c.status !== 'NEED_FIX') throw new AppError('INVALID_STATE');
      if (c.fix_deadline && nowD.getTime() >= ms(c.fix_deadline)) throw new AppError('FIX_WINDOW_EXPIRED');
      const f = checkFixFile(req, c);
      const now = time.toIso(nowD);
      const last = db.prepare('SELECT * FROM case_returns WHERE case_id = ? ORDER BY n DESC LIMIT 1').get(c.id);
      const returnedAt = c.returned_at || (last && last.returned_at) || now;
      const hol = holidays(); // A-42: holiday table AT resubmit time
      const dueAt = rules.extendDueOnResubmit(c.due_at, returnedAt, now, hol); // B04 handled in rules.js
      let paused = null;
      try { paused = rules.pausedWorkingDays(returnedAt, now, hol); } catch (e) { paused = null; }
      const file = f ? storeFixFile(c, f, now) : null;
      // A-29: back to IN_REVIEW with the same holder at the same step (no workload check)
      db.prepare(`UPDATE cases SET status = 'IN_REVIEW', due_at = ?, fix_deadline = NULL, updated_at = ? WHERE id = ?`)
        .run(dueAt, now, c.id);
      if (last) db.prepare('UPDATE case_returns SET resubmitted_at = ?, paused_days = ? WHERE case_id = ? AND n = ?')
        .run(now, paused, c.id, last.n);
      event(c.id, 'citizen', 'NEED_FIX', 'IN_REVIEW', file ? `ส่งเอกสารแก้ไข (${file.name})` : 'ส่งเอกสารแก้ไข', now);
      const body = { status: 'IN_REVIEW', dueAt, owner: c.owner || null };
      if (file) body.file = file;
      return body;
    })();
    res.json(out);
  });

  // ─────────────────────────── pages ───────────────────────────
  // /citizen — welcome · start service · my cases (number desc) · drafts (no EG- text)
  app.get('/citizen', guard.page('citizen'), (req, res) => {
    const me = db.prepare('SELECT full_name FROM citizens WHERE id = ?').get(req.user.id);
    const hol = holidays();
    const services = db.prepare('SELECT id, name, fee, fee_per_sqm, sla FROM services ORDER BY sort, id').all();
    res.render('citizen-home', {
      title: 'หน้าหลักประชาชน',
      fullName: me ? me.full_name : req.user.name,
      services: services.map((s) => ({ ...s, name: labels.SERVICE_NAME[s.id] || s.name })),
      cases: myCases(req.user.id).map((c) => ({
        caseNo: c.case_no, serviceId: c.service_id, serviceName: labels.SERVICE_NAME[c.service_id] || c.service_name,
        status: c.status, dueAt: c.due_at, level: levelOf(c, hol),
      })),
      drafts: myDrafts(req.user.id).map((c) => ({
        draftId: c.draft_id, serviceId: c.service_id, serviceName: labels.SERVICE_NAME[c.service_id] || c.service_name,
        status: c.status, fee: ctx.apply && ctx.apply.currentFee ? ctx.apply.currentFee(c) : c.fee,
      })),
    });
  });

  // /citizen/cases/:caseNo — central guard already 404'd non-owners (B06 lets GET through: do NOT re-check here)
  app.get('/citizen/cases/:caseNo', guard.page('citizen'), async (req, res, next) => {
    try {
      const c = caseByNo(req.params.caseNo);
      if (!c || !(ctx.auth ? ctx.auth.citizenCanView(req, c) : Number(c.citizen_id) === Number(req.user.id))) {
        return guard.renderNotFound(req, res);
      }
      const owns = Number(c.citizen_id) === Number(req.user.id);
      const nowD = clock.now();
      const hol = holidays();
      const files = db.prepare('SELECT id, name, doc_key, size FROM files WHERE case_id = ? AND deleted = 0 ORDER BY created_at, id').all(c.id);
      const events = db.prepare('SELECT * FROM case_events WHERE case_id = ? ORDER BY time, id').all(c.id);
      const lastReturn = c.status === 'NEED_FIX'
        ? db.prepare('SELECT * FROM case_returns WHERE case_id = ? ORDER BY n DESC LIMIT 1').get(c.id) : null;
      const doc = c.doc_no
        ? db.prepare('SELECT doc_no, verify_code FROM documents WHERE doc_no = ?').get(c.doc_no)
        : db.prepare('SELECT doc_no, verify_code FROM documents WHERE case_id = ? ORDER BY issued_at DESC LIMIT 1').get(c.id);
      let verifyUrl = null;
      let qrDataUrl = null;
      if (doc) {
        verifyUrl = `${req.protocol}://${req.get('host')}/verify/${doc.verify_code}`;
        try { qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 160 }); } catch (e) { qrDataUrl = null; }
      }
      const fixOpen = c.status === 'NEED_FIX' && (!c.fix_deadline || nowD.getTime() < ms(c.fix_deadline));
      const docs = ctx.apply && ctx.apply.docsOf ? ctx.apply.docsOf(c.service_id) : [];
      res.render('citizen-case', {
        title: `คำขอ ${c.case_no}`,
        v: {
          caseNo: c.case_no, status: c.status, serviceId: c.service_id,
          serviceName: labels.SERVICE_NAME[c.service_id] || c.service_name,
          stepLabel: c.service_id === 'SV-03' ? STEP_LABEL[Number(c.step) || 1] : null,
          fee: c.fee, paidAt: c.paid_at, receiptNo: c.receipt_no, dueAt: c.due_at, level: levelOf(c, hol),
          closedAt: ['COMPLETED', 'REJECTED'].includes(c.status) ? c.closed_at : null,
          cancelledAt: c.status === 'CANCELLED' ? c.cancelled_at : null,
          idFull: mask.formatId(idNoOf(c)), applicantName: c.applicant_name,
          fixDeadline: c.status === 'NEED_FIX' ? c.fix_deadline : null, lastReturn,
          rejectReason: c.status === 'REJECTED' ? c.reject_reason : null,
          docNo: doc ? doc.doc_no : null, verifyCode: doc ? doc.verify_code : null, verifyUrl, qrDataUrl,
          noRefund: c.status === 'REJECTED' || c.status === 'CANCELLED',
        },
        files, events, noRefundText: NO_REFUND,
        fixDocs: docs.map((d) => ({ key: d.doc_key, name: d.name })),
        can: {
          cancel: owns && c.status === 'SUBMITTED' && !c.owner,
          resubmit: owns && fixOpen,
        },
      });
    } catch (e) { next(e); }
  });

  // labels for the wizard / other blocks
  ctx.payments.PAY_TH = PAY_TH;
};
