'use strict';
// B05 · Citizen apply: 3-step wizard · drafts · uploads
//   FR-04 catalog + service form + live fee (BR-04 BR-05 via rules.js)
//   FR-05 uploads: PDF/JPG/PNG by magic bytes (BR-06) · ≤ 5,242,880 bytes (BR-07) · ≤ 5 files per request (BR-07, A-49)
//   FR-06 required docs before payment, missing names in table-4.3 order (BR-08)
//   FR-07 drafts (no case number) saved + reopened via /citizen/new/:service?draft=DR-0003 (A-47)
//   BUG_MODE B02: 5,242,880 bytes exactly is rejected (uses < instead of ≤)
//
// Owns:  page  GET /citizen/new/:service[?draft=]
//        API   POST /api/drafts · GET /api/drafts · GET|PATCH|PUT|DELETE /api/drafts/:id
//              POST /api/drafts/:id/files · DELETE /api/drafts/:id/files/:fileId · GET /api/drafts/:id/qr.svg?ref=
// NOT here (B06 payments.js): POST /api/drafts/:id/payment · GET /api/payments/:ref · pay hook · /citizen list.
// Step 3 of the wizard (views/citizen-new.ejs + public/js/citizen-apply.js) calls those B06 APIs.
//
// Exposes ctx.apply = { MAX_FILE_BYTES, MAX_FILES, docsOf(serviceId), filesOf(caseId), missingDocs(caseRow),
//                       assertDocsComplete(caseRow), currentFee(caseRow), draftJson(caseRow) }
// so B06 can answer 409 MISSING_DOCS {missing:[…]} and lock the fee with the same rules.
// Central RBAC/ownership (auth.js) already runs before these routes: /api/drafts* = citizen only,
// /api/drafts/:id of someone else / missing / deleted → 404, /citizen/new/:sv?draft=<not mine> → 404 page.

const rules = require('./rules');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5,242,880 (A-10)
const MAX_FILES = 5;                     // all slots together (A-49)
const EXTRA = { doc_key: 'extra', name: 'เอกสารเพิ่มเติม', required: 0, pdf_only: 0, multiple: true };
const EDITABLE = new Set(['DRAFT']);
const OPEN_DRAFT = ['DRAFT', 'PENDING_PAYMENT'];

// Service-specific optional form fields (FR-04). Not validated beyond length; stored in cases.form.
const FORM_FIELDS = {
  'SV-01': [{ key: 'purpose', label: 'วัตถุประสงค์ในการขอหนังสือรับรอง (ไม่บังคับ)' }],
  'SV-02': [{ key: 'businessName', label: 'ชื่อกิจการ (ไม่บังคับ)' }, { key: 'businessType', label: 'ประเภทกิจการ (ไม่บังคับ)' }],
  'SV-03': [{ key: 'siteAddress', label: 'ที่ตั้งอาคาร (ไม่บังคับ)' }],
};

module.exports = function register(app, ctx) {
  const { db, clock, nextNumber, errors, guard, upload, bugMode, labels } = ctx;
  const { AppError } = errors;

  // ─────────────────────────── data helpers ───────────────────────────
  const serviceRow = (id) => db.prepare('SELECT * FROM services WHERE id = ?').get(String(id || ''));

  function docsOf(serviceId) {
    const rows = db.prepare('SELECT doc_key, name, required, pdf_only, sort FROM service_docs WHERE service_id = ? ORDER BY sort, doc_key')
      .all(serviceId);
    return [...rows.map((r) => ({ ...r, multiple: false })), EXTRA];
  }

  function filesOf(caseId) {
    return db.prepare('SELECT id, doc_key, name, mime, size FROM files WHERE case_id = ? AND deleted = 0 ORDER BY id')
      .all(caseId);
  }

  const fileJson = (f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size });

  /** names of required docs without a file, in service order (BR-08) */
  function missingDocs(caseRow) {
    const have = new Set(filesOf(caseRow.id).map((f) => f.doc_key));
    return docsOf(caseRow.service_id).filter((d) => d.required && !have.has(d.doc_key)).map((d) => d.name);
  }
  const missingMessage = (names) => `ยังขาดเอกสาร: ${names.join(', ')}`;

  /** throws 409 MISSING_DOCS {missing} if incomplete (for B06 POST /api/drafts/:id/payment) */
  function assertDocsComplete(caseRow) {
    const missing = missingDocs(caseRow);
    if (missing.length) throw new AppError('MISSING_DOCS', { missing }, missingMessage(missing));
  }

  /** fee from the CURRENT service price (drafts) — PENDING_PAYMENT and later keep the locked cases.fee (A-42) */
  function currentFee(caseRow) {
    if (caseRow.status !== 'DRAFT') return caseRow.fee;
    const r = rules.feeResult(serviceRow(caseRow.service_id), { qty: caseRow.qty, areaSqm: caseRow.area_sqm });
    return r.fee == null ? caseRow.fee : r.fee;
  }

  const parseForm = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };

  function draftJson(c) {
    return {
      draftId: c.draft_id,
      serviceId: c.service_id,
      status: c.status,
      fee: currentFee(c),
      qty: c.qty == null ? null : c.qty,
      areaSqm: c.area_sqm == null ? null : c.area_sqm,
      form: parseForm(c.form),
      caseNo: c.case_no || null,
      files: filesOf(c.id).map(fileJson),
      missing: missingDocs(c),
    };
  }

  ctx.apply = { MAX_FILE_BYTES, MAX_FILES, docsOf, filesOf, missingDocs, assertDocsComplete, currentFee, draftJson, missingMessage };

  /** own draft row (central ownership already ran; this is defence in depth and loads the full row) */
  function ownDraft(req) {
    const c = db.prepare('SELECT * FROM cases WHERE draft_id = ? AND citizen_id = ? AND deleted = 0')
      .get(String(req.params.draftId || ''), req.user.id);
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  function cleanForm(serviceId, input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const f of FORM_FIELDS[serviceId] || []) {
      if (input[f.key] != null) out[f.key] = String(input[f.key]).slice(0, 300);
    }
    return out;
  }

  /** validate service input → { qty, area_sqm, fee } (throws INVALID_QTY / INVALID_AREA / AREA_TOO_LARGE) */
  function priced(svc, body) {
    const qty = svc.id === 'SV-01' ? body.qty : undefined;
    const areaSqm = svc.id === 'SV-03' ? (body.areaSqm !== undefined ? body.areaSqm : body.area_sqm) : undefined;
    const fee = rules.computeFee(svc, { qty, areaSqm });
    return {
      qty: svc.id === 'SV-01' ? parseInt(qty, 10) : null,
      area_sqm: svc.id === 'SV-03' ? parseInt(areaSqm, 10) : null,
      fee,
    };
  }

  const nextDraftId = () => `DR-${String(nextNumber('draft', 0)).padStart(4, '0')}`;
  const nextFileId = () => `F-${String(nextNumber('file', 0)).padStart(6, '0')}`;

  /** multer gives latin1-decoded names; recover UTF-8 and strip path / control chars */
  function fileName(raw) {
    let n = String(raw || 'file');
    try {
      const u = Buffer.from(n, 'latin1').toString('utf8');
      if (!u.includes('�')) n = u;
    } catch (e) { /* keep raw */ }
    n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>]/g, '').trim();
    return (n || 'file').slice(0, 200);
  }

  // ─────────────────────────── API §6.2 drafts ───────────────────────────
  // POST /api/drafts {"serviceId","qty"|"areaSqm",form?} → 201 {"draftId","fee",...}
  app.post('/api/drafts', guard.api('citizen'), (req, res) => {
    const b = req.body || {};
    const svc = serviceRow(b.serviceId);
    if (!svc) throw new AppError('BAD_REQUEST');
    const p = priced(svc, b);
    const now = clock.nowIso();
    const row = db.transaction(() => {
      const draftId = nextDraftId();
      db.prepare(`INSERT INTO cases(draft_id, service_id, citizen_id, status, qty, area_sqm, form, fee, created_at, updated_at)
                  VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`)
        .run(draftId, svc.id, req.user.id, p.qty, p.area_sqm, JSON.stringify(cleanForm(svc.id, b.form)), p.fee, now, now);
      return db.prepare('SELECT * FROM cases WHERE draft_id = ?').get(draftId);
    })();
    res.status(201).json(draftJson(row));
  });

  // GET /api/drafts → {items:[{draftId,serviceId,status,fee}]} (my DRAFT / PENDING_PAYMENT, no case number)
  app.get('/api/drafts', guard.api('citizen'), (req, res) => {
    const rows = db.prepare(`SELECT * FROM cases WHERE citizen_id = ? AND deleted = 0 AND case_no IS NULL
                             AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY draft_id`).all(req.user.id);
    res.json({ items: rows.map((c) => ({ draftId: c.draft_id, serviceId: c.service_id, status: c.status, fee: currentFee(c) })) });
  });

  app.get('/api/drafts/:draftId', guard.api('citizen'), (req, res) => {
    res.json(draftJson(ownDraft(req)));
  });

  // PATCH/PUT /api/drafts/:id {"qty"|"areaSqm",form?} → 200 draft (DRAFT only; fee locked afterwards A-42)
  function updateDraft(req, res) {
    const c = ownDraft(req);
    if (!EDITABLE.has(c.status)) throw new AppError('INVALID_STATE');
    const b = req.body || {};
    const svc = serviceRow(c.service_id);
    const merged = {
      qty: b.qty !== undefined ? b.qty : c.qty,
      areaSqm: b.areaSqm !== undefined ? b.areaSqm : (b.area_sqm !== undefined ? b.area_sqm : c.area_sqm),
    };
    const p = priced(svc, merged);
    const form = b.form !== undefined ? cleanForm(c.service_id, b.form) : parseForm(c.form);
    db.prepare('UPDATE cases SET qty = ?, area_sqm = ?, fee = ?, form = ?, updated_at = ? WHERE id = ?')
      .run(p.qty, p.area_sqm, p.fee, JSON.stringify(form), clock.nowIso(), c.id);
    res.json(draftJson(db.prepare('SELECT * FROM cases WHERE id = ?').get(c.id)));
  }
  app.patch('/api/drafts/:draftId', guard.api('citizen'), updateDraft);
  app.put('/api/drafts/:draftId', guard.api('citizen'), updateDraft);

  // DELETE /api/drafts/:id → 204 (DRAFT / unpaid PENDING_PAYMENT; its payment refs then 404) · paid → 409 INVALID_STATE
  app.delete('/api/drafts/:draftId', guard.api('citizen'), (req, res) => {
    const c = ownDraft(req);
    const paid = db.prepare("SELECT 1 FROM payments WHERE case_id = ? AND status = 'PAID'").get(c.id);
    if (c.case_no || !OPEN_DRAFT.includes(c.status) || paid) throw new AppError('INVALID_STATE');
    db.transaction(() => {
      db.prepare('DELETE FROM payments WHERE case_id = ?').run(c.id);
      db.prepare('DELETE FROM files WHERE case_id = ?').run(c.id);
      db.prepare('UPDATE cases SET deleted = 1, updated_at = ? WHERE id = ?').run(clock.nowIso(), c.id);
    })();
    res.status(204).end();
  });

  // POST /api/drafts/:id/files multipart file + docKey → 201 {"fileId","name","docKey","size"}
  // check order: size → type (magic bytes only) → plan PDF → count. Rejected files are not stored/counted.
  app.post('/api/drafts/:draftId/files', guard.api('citizen'), upload.single('file'), (req, res) => {
    const c = ownDraft(req);
    if (!EDITABLE.has(c.status)) throw new AppError('INVALID_STATE');
    const docKey = String((req.body && req.body.docKey) || '').trim();
    const doc = docsOf(c.service_id).find((d) => d.doc_key === docKey);
    if (!doc || !req.file) throw new AppError('BAD_REQUEST');

    const buf = req.file.buffer;
    const size = buf.length;
    // BR-07: ≤ 5,242,880 · B02: "<" so exactly 5,242,880 is wrongly rejected
    const sizeOk = bugMode('B02') ? size < MAX_FILE_BYTES : size <= MAX_FILE_BYTES;
    if (!sizeOk) throw new AppError('FILE_TOO_LARGE');
    const mime = upload.sniff(buf); // never trust extension / Content-Type (A-49)
    if (!mime) throw new AppError('FILE_TYPE');
    if (doc.pdf_only && mime !== 'application/pdf') throw new AppError('PLAN_NOT_PDF');

    const out = db.transaction(() => {
      const files = filesOf(c.id);
      // single-file slots: a new upload replaces the old one (so it does not count twice)
      const replaced = doc.multiple ? [] : files.filter((f) => f.doc_key === docKey);
      if (files.length - replaced.length + 1 > MAX_FILES) throw new AppError('FILE_COUNT');
      for (const f of replaced) db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
      const id = nextFileId();
      const name = fileName(req.file.originalname);
      db.prepare(`INSERT INTO files(id, case_id, doc_key, name, mime, size, data, created_at, deleted)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(id, c.id, docKey, name, mime, size, buf, clock.nowIso());
      return { fileId: id, name, docKey, size, replaced: replaced.map((f) => f.id) };
    })();
    res.status(201).json(out);
  });

  // DELETE /api/drafts/:id/files/:fileId → 204 (file-remove-btn)
  app.delete('/api/drafts/:draftId/files/:fileId', guard.api('citizen'), (req, res) => {
    const c = ownDraft(req);
    if (!EDITABLE.has(c.status)) throw new AppError('INVALID_STATE');
    const r = db.prepare('DELETE FROM files WHERE id = ? AND case_id = ?').run(String(req.params.fileId), c.id);
    if (!r.changes) throw new AppError('NOT_FOUND');
    res.status(204).end();
  });

  // GET /api/drafts/:id/qr.svg?ref=PP-0002 → mock PromptPay QR image (qr-image)
  app.get('/api/drafts/:draftId/qr.svg', guard.api('citizen'), (req, res) => {
    const c = ownDraft(req);
    const p = db.prepare('SELECT ref, amount FROM payments WHERE ref = ? AND case_id = ?').get(String(req.query.ref || ''), c.id);
    if (!p) throw new AppError('NOT_FOUND');
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(qrSvg(`PROMPTPAY-MOCK|${p.ref}|${p.amount}`));
  });

  // ─────────────────────────── page /citizen/new/:service ───────────────────────────
  app.get('/citizen/new/:service', guard.page('citizen'), (req, res) => {
    const svc = serviceRow(req.params.service);
    if (!svc) return res.status(404).render('error', { title: 'ไม่พบหน้า', message: 'ไม่พบบริการที่ต้องการ' });

    let c = null;
    if (req.query.draft) {
      c = db.prepare('SELECT * FROM cases WHERE draft_id = ? AND citizen_id = ? AND deleted = 0')
        .get(String(req.query.draft), req.user.id);
      if (!c) return guard.renderNotFound(req, res);
      if (c.service_id !== svc.id) return res.redirect(`/citizen/new/${encodeURIComponent(c.service_id)}?draft=${encodeURIComponent(c.draft_id)}`);
      if (c.case_no) return res.redirect(`/citizen/cases/${encodeURIComponent(c.case_no)}`);
      if (!OPEN_DRAFT.includes(c.status)) return guard.renderNotFound(req, res);
    }

    const pay = c ? db.prepare(`SELECT ref, amount, status, qr_created_at, qr_expires_at FROM payments
                                WHERE case_id = ? ORDER BY qr_created_at DESC, ref DESC LIMIT 1`).get(c.id) : null;
    const draft = c ? draftJson(c) : null;
    const step = c && c.status === 'PENDING_PAYMENT' ? 3 : 1;
    const defaults = svc.id === 'SV-01' ? { qty: 1, areaSqm: null } : { qty: null, areaSqm: null };
    const state = {
      service: { id: svc.id, name: labels.SERVICE_NAME[svc.id] || svc.name, fee: svc.fee, feePerSqm: svc.fee_per_sqm },
      bugB01: !!bugMode('B01'),
      limits: { maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES },
      messages: {
        INVALID_QTY: errors.messageOf('INVALID_QTY'),
        INVALID_AREA: errors.messageOf('INVALID_AREA'),
        AREA_TOO_LARGE: errors.messageOf('AREA_TOO_LARGE'),
        INTERNAL: errors.messageOf('INTERNAL'),
      },
      docs: docsOf(svc.id).map((d) => ({ key: d.doc_key, name: d.name, required: !!d.required, pdfOnly: !!d.pdf_only, multiple: !!d.multiple })),
      step,
      draft: draft || { draftId: null, serviceId: svc.id, status: 'DRAFT', fee: null, qty: defaults.qty, areaSqm: defaults.areaSqm, form: {}, files: [], missing: [] },
      payment: pay ? { ref: pay.ref, amount: pay.amount, status: pay.status, qrCreatedAt: pay.qr_created_at, qrExpiresAt: pay.qr_expires_at } : null,
    };
    if (!draft) {
      const r = rules.feeResult(svc, { qty: defaults.qty, areaSqm: defaults.areaSqm });
      state.draft.fee = r.fee;
      state.draft.missing = docsOf(svc.id).filter((d) => d.required).map((d) => d.name);
    }

    res.render('citizen-new', {
      title: `ยื่นคำขอ ${state.service.name}`,
      svc: state.service,
      formFields: FORM_FIELDS[svc.id] || [],
      state,
      stateJson: JSON.stringify(state).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => (ch === '\u2028' ? '\\u2028' : '\\u2029')),
    });
  });

  // ─────────────────────────── mock QR (svg) ───────────────────────────
  let QR = null;
  try { QR = require('qrcode'); } catch (e) { QR = null; }
  function qrSvg(text) {
    let size = 21; let dark = () => false;
    if (QR && typeof QR.create === 'function') {
      const m = QR.create(text, { errorCorrectionLevel: 'M' }).modules;
      size = m.size; dark = (x, y) => !!m.get(y, x);
    } else { // deterministic fallback pattern
      let h = 2166136261;
      for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      dark = (x, y) => (((h >>> ((x * 7 + y * 3) % 31)) ^ (x * y)) & 1) === 1;
    }
    const q = 2; const n = size + q * 2; let d = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="200" height="200" shape-rendering="crispEdges">`
      + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
};
