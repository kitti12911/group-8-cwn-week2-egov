'use strict';
// B08 · Digital document: PDF download · public verify page/API · tamper test hook
// (REQUIREMENTS FR-17 FR-18 BR-23 · DECISIONS §10 · CONTRACT §2.6 §2.13 §3 §6.4 §8 · TEST-DATA §5)
//
// Document rows are created by officer.js (B07 POST /api/officer/cases/:no/issue): DOC-<BE>-nnnnnn,
// 8-char verify code, valid_until (BR-23), signer = approver, signature = crypto.sign([...7 fields]).
// This module only reads them:
//   GET  /api/documents/:docNo/pdf      citizen owner (central 404 in auth.js) · officer · head → application/pdf
//   GET  /verify/:code                  public page (no login) · 200 VALID/EXPIRED/TAMPERED · 404 NOT_FOUND
//   GET  /api/verify/:code              public JSON (same decision)
//   POST /api/test/documents/:docNo/tamper  (TEST_MODE only) change stored data without re-signing
// Exposes ctx.documents = { check, verifyByCode, signatureOf, isSignatureValid, expiresAt, buildPdf }
// (no ctx.documents.create → officer.js keeps its own creator).
const fs = require('fs');
const nodeCrypto = require('crypto');
const QRCode = require('qrcode');

module.exports = function register(app, ctx) {
  const { db, clock, time, crypto, mask, labels, errors, testRouter } = ctx;
  const str = (v) => (v == null ? '' : String(v));

  const SIGNED_FIELDS = (d) => [d.doc_no, d.case_no, d.applicant, d.service_id, d.issued_at, d.valid_until, d.signer];
  const signatureOf = (d) => crypto.sign(SIGNED_FIELDS(d));

  function isSignatureValid(d) {
    const want = Buffer.from(signatureOf(d), 'utf8');
    const got = Buffer.from(str(d.signature), 'utf8');
    return want.length === got.length && nodeCrypto.timingSafeEqual(want, got);
  }

  /** first instant the document is no longer valid = 00:00 Bangkok of the day after valid_until (A-43) */
  function expiresAt(validUntil) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(validUntil));
    if (!m) return null;
    return time.at(+m[1], +m[2], +m[3] + 1, 0, 0, 0);
  }

  /** decision table (DECISIONS §10, A-43): tampered wins over expired */
  function check(d, now = clock.now()) {
    if (!d) return 'NOT_FOUND';
    if (!isSignatureValid(d)) return 'TAMPERED';
    const exp = expiresAt(d.valid_until);
    if (!exp || now.getTime() >= exp.getTime()) return 'EXPIRED';
    return 'VALID';
  }

  const docByCode = (code) => db.prepare('SELECT * FROM documents WHERE verify_code = ?').get(str(code)) || null;
  const docByNo = (docNo) => db.prepare('SELECT * FROM documents WHERE doc_no = ?').get(str(docNo)) || null;

  /** public view — never the full name (PDPA A-54); TAMPERED/NOT_FOUND carry only result */
  function verifyByCode(code) {
    const d = docByCode(code);
    const result = check(d);
    if (result === 'NOT_FOUND' || result === 'TAMPERED') return { result };
    return {
      result,
      docNo: d.doc_no,
      applicantMasked: mask.maskName(d.applicant),
      serviceId: d.service_id,
      issuedAt: time.toIso(d.issued_at),
      validUntil: d.valid_until,
      signer: d.signer,
    };
  }

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
  const verifyUrl = (req, code) => `${baseUrl(req)}/verify/${code}`;

  // ───────────────────────────── public verify ─────────────────────────────
  const RESULT_TH = { VALID: 'เอกสารถูกต้อง', EXPIRED: 'เอกสารหมดอายุ', TAMPERED: 'ลายเซ็นไม่ถูกต้อง', NOT_FOUND: 'ไม่พบเอกสาร' };

  app.get('/api/verify/:code', (req, res) => {
    const v = verifyByCode(req.params.code);
    res.set('Cache-Control', 'no-store');
    res.status(v.result === 'NOT_FOUND' ? 404 : 200).json(v);
  });

  app.get('/verify/:code', (req, res) => {
    const v = verifyByCode(req.params.code);
    res.set('Cache-Control', 'no-store');
    res.status(v.result === 'NOT_FOUND' ? 404 : 200).render('verify', {
      title: 'ตรวจสอบเอกสาร',
      v,
      resultTh: RESULT_TH[v.result],
      serviceLabel: v.serviceId ? `${v.serviceId} ${labels.SERVICE_NAME[v.serviceId] || ''}`.trim() : '',
      code: str(req.params.code),
    });
  });

  // ───────────────────────────── PDF download ─────────────────────────────
  const THAI_FONTS = [
    process.env.PDF_THAI_FONT,
    '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
    '/usr/share/fonts/truetype/tlwg/Loma.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSerifThai-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSerif.ttf',
  ].filter(Boolean);
  let thaiFontPath;
  const thaiFont = () => {
    if (thaiFontPath === undefined) thaiFontPath = THAI_FONTS.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
    return thaiFontPath;
  };

  /** Buffer of the PDF (uncompressed so the ASCII machine line is in the raw bytes, CONTRACT §3) */
  async function buildPdf(d, url) {
    const PDFDocument = require('pdfkit');
    const machineLine = `docNo=${d.doc_no} caseNo=${d.case_no} verify=${d.verify_code} validUntil=${d.valid_until}`;
    const qrPng = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 220 });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4', margin: 50, compress: false,
        info: { Title: d.doc_no, Subject: machineLine, Keywords: machineLine, Author: 'e-Service City (fictional)' },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const issuedIso = time.toIso(d.issued_at);
      const tf = thaiFont();
      doc.font('Helvetica-Bold').fontSize(16).text('Digital Document · e-Service (fictional city)');
      doc.moveDown(0.3);
      if (tf) {
        doc.font(tf).fontSize(14).text('เอกสารดิจิทัล เทศบาลนครตัวอย่าง (สมมติ)');
        doc.fontSize(12);
        for (const [k, val] of [
          ['เลขเอกสาร', d.doc_no],
          ['เลขคำขอ', d.case_no],
          ['ชื่อผู้ยื่น', d.applicant],
          ['บริการ', `${d.service_id} ${labels.SERVICE_NAME[d.service_id] || ''}`],
          ['วันออก', time.thaiDateTime(d.issued_at)],
          ['ใช้ได้ถึง (วันหมดอายุ)', time.thaiDate(d.valid_until)],
          ['ผู้ลงนาม', d.signer],
          ['รหัสตรวจสอบ', d.verify_code],
          ['ตรวจสอบที่', url],
        ]) doc.text(`${k}: ${val}`);
      }
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10);
      for (const [k, val] of [
        ['Document no', d.doc_no], ['Case no', d.case_no], ['Service', d.service_id],
        ['Issued at', issuedIso], ['Valid until (last valid day)', d.valid_until],
        ['Verify code', d.verify_code], ['Verify URL', url],
        ['Signature (HMAC-SHA256, simulated)', d.signature],
      ]) doc.text(`${k}: ${val}`);
      doc.moveDown(0.5);
      doc.image(qrPng, { width: 140 });
      doc.moveDown(0.5);
      // single machine-readable ASCII line (TC-DOC-01) — also emitted as a literal comment in the content stream
      doc.font('Helvetica').fontSize(9).text(machineLine);
      doc.addContent(`% ${machineLine}`);
      doc.end();
    });
  }

  // auth.js already: 401 anonymous · 403 other roles · 404 citizen not owner / unknown doc
  app.get('/api/documents/:docNo/pdf', async (req, res, next) => {
    try {
      const d = docByNo(req.params.docNo);
      if (!d) return errors.sendError(res, 'NOT_FOUND');
      if (req.user && req.user.role === 'citizen' && ctx.auth && typeof ctx.auth.citizenOwns === 'function') {
        const c = db.prepare('SELECT id, citizen_id, case_no FROM cases WHERE id = ?').get(d.case_id);
        if (!c || !ctx.auth.citizenOwns(req, c)) return errors.sendError(res, 'NOT_FOUND');
      }
      const pdf = await buildPdf(d, verifyUrl(req, d.verify_code));
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${d.doc_no}.pdf"`);
      res.set('Cache-Control', 'no-store');
      res.send(pdf);
    } catch (e) { next(e); }
  });

  // ───────────────────────────── test hook ─────────────────────────────
  // change stored data (extend validity + alter name) WITHOUT re-signing → verify says TAMPERED
  testRouter.post('/documents/:docNo/tamper', (req, res) => {
    const d = docByNo(req.params.docNo);
    if (!d) return errors.sendError(res, 'NOT_FOUND');
    const m = /^(\d{4})(-\d{2}-\d{2})$/.exec(str(d.valid_until));
    const newUntil = m ? `${+m[1] + 10}${m[2]}` : '2099-12-31';
    db.prepare('UPDATE documents SET valid_until = ?, applicant = ? WHERE doc_no = ?')
      .run(newUntil, `${d.applicant} (แก้ไข)`, d.doc_no);
    res.json({ ok: true });
  });

  ctx.documents = Object.assign(ctx.documents || {}, { check, verifyByCode, signatureOf, isSignatureValid, expiresAt, buildPdf });
};
