// B05 · /citizen/new/:service wizard (CONTRACT §2.5)
// step 1: live fee (mirror of rules.js BR-04/BR-05, server re-validates with rules.js) · save draft
// step 2: uploads → POST /api/drafts/:id/files (server checks magic bytes / size / count) · missing docs
// step 3: QR + payment status → B06 APIs POST /api/drafts/:id/payment · GET /api/payments/:ref
(function () {
  'use strict';
  var S = JSON.parse(document.getElementById('wizard-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var STEP_TEXT = { 1: '1/3 กรอกข้อมูล', 2: '2/3 แนบเอกสาร', 3: '3/3 ชำระเงิน' };
  var STATUS_TH = { DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว' };
  var PAY_TH = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' };
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var svc = S.service;
  var draft = S.draft;
  var payment = S.payment;
  var busy = false;
  var pollTimer = null;

  // ── formatting ─────────────────────────────────────────────
  function baht(n) { return '฿' + Number(n).toLocaleString('en-US'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** ISO (any offset) → "1 ธ.ค. 2569 09:15" in Bangkok time */
  function thaiDT(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    var b = new Date(t.getTime() + 7 * 3600 * 1000);
    return b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + (b.getUTCFullYear() + 543) + ' ' + pad(b.getUTCHours()) + ':' + pad(b.getUTCMinutes());
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function timeEl(iso, testid, prefix) {
    var e = el('time', { 'data-testid': testid, 'data-iso': iso, datetime: iso }, (prefix || '') + thaiDT(iso));
    return e;
  }
  function errMsg(r) { return (r && r.data && r.data.message) || S.messages.INTERNAL; }

  // ── step switching ─────────────────────────────────────────
  function setStep(n) {
    S.step = n;
    [1, 2, 3].forEach(function (i) {
      $('step-' + i).hidden = i !== n;
      var li = document.querySelector('.stepper li[data-step="' + i + '"]');
      if (li) { if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }
    });
    document.querySelector('[data-testid="wizard-step"]').textContent = STEP_TEXT[n];
    if (n === 2) renderFiles();
    if (n === 3) renderPayment();
    var h = $('h-step-' + n);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); }
  }

  function showDraft() {
    if (!draft.draftId) return;
    $('draft-line').hidden = false;
    document.querySelector('[data-testid="draft-id"]').textContent = draft.draftId;
    var st = document.querySelector('[data-testid="draft-status"]');
    if (st) { st.setAttribute('data-status', draft.status); st.className = 'badge st-' + draft.status; st.textContent = STATUS_TH[draft.status] || draft.status; }
    var url = location.pathname + '?draft=' + encodeURIComponent(draft.draftId);
    if (location.search !== '?draft=' + draft.draftId) history.replaceState(null, '', url);
    $('back-to-2').hidden = draft.status !== 'DRAFT';
  }

  // ── step 1: fee (mirror of server/rules.js) ────────────────
  var qtyIn = $('qty-input');
  var areaIn = $('area-input');
  var touched = false;

  function toInt(v) { v = String(v == null ? '' : v).trim(); return /^-?\d+$/.test(v) ? parseInt(v, 10) : null; }
  function calcFee() {
    if (svc.id === 'SV-01') {
      var q = toInt(qtyIn.value);
      if (q === null || q < 1 || q > 5) return { fee: null, code: 'INVALID_QTY' };
      return { fee: svc.fee * q };
    }
    if (svc.id === 'SV-03') {
      var a = toInt(areaIn.value);
      if (a === null || a < 1) return { fee: null, code: 'INVALID_AREA', empty: String(areaIn.value).trim() === '' };
      if (a > 500) return { fee: null, code: 'AREA_TOO_LARGE' };
      var sur = S.bugB01 ? a > 101 : a > 100; // BUG_MODE B01 mirrors rules.js
      return { fee: sur ? svc.fee + svc.feePerSqm * (a - 100) : svc.fee };
    }
    return { fee: svc.fee };
  }
  function showFeeError(msg) {
    var fe = $('fee-error');
    fe.textContent = msg || '';
    fe.hidden = !msg;
  }
  function updateFee() {
    if (draft.status !== 'DRAFT') { $('fee-total').textContent = draft.fee == null ? '–' : baht(draft.fee); return; }
    var r = calcFee();
    $('fee-total').textContent = r.fee == null ? '–' : baht(r.fee);
    showFeeError(r.fee == null && !(r.empty && !touched) ? S.messages[r.code] : '');
    $('to-upload-btn').disabled = r.fee == null;
    if (r.fee != null) { draft.fee = r.fee; $('payment-amount').textContent = baht(r.fee); }
    return r;
  }
  function bodyFromForm() {
    var b = { serviceId: svc.id, form: {} };
    if (qtyIn) b.qty = toInt(qtyIn.value) === null ? qtyIn.value : toInt(qtyIn.value);
    if (areaIn) b.areaSqm = toInt(areaIn.value) === null ? areaIn.value : toInt(areaIn.value);
    document.querySelectorAll('[data-form-field]').forEach(function (i) { b.form[i.getAttribute('data-form-field')] = i.value; });
    return b;
  }
  /** create (POST) or update (PATCH) the draft with the step-1 values */
  async function saveDraft() {
    if (draft.status !== 'DRAFT') return true;
    var b = bodyFromForm();
    var r = draft.draftId
      ? await egov.api('PATCH', '/api/drafts/' + encodeURIComponent(draft.draftId), b)
      : await egov.api('POST', '/api/drafts', b);
    if (!r.ok) {
      if (r.data && /^(INVALID_QTY|INVALID_AREA|AREA_TOO_LARGE)$/.test(r.data.code)) showFeeError(r.data.message);
      else egov.showError(errMsg(r));
      return false;
    }
    draft = r.data;
    showDraft();
    $('fee-total').textContent = draft.fee == null ? '–' : baht(draft.fee);
    $('payment-amount').textContent = draft.fee == null ? '–' : baht(draft.fee);
    return true;
  }

  if (qtyIn) qtyIn.addEventListener('input', function () { touched = true; updateFee(); });
  if (areaIn) areaIn.addEventListener('input', function () { touched = true; updateFee(); });
  $('form-1').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    touched = true;
    var r = updateFee();
    if (busy || (r && r.fee == null)) return;
    busy = true;
    try { if (await saveDraft()) setStep(2); } finally { busy = false; }
  });
  $('save-draft-btn').addEventListener('click', async function () {
    touched = true;
    var r = updateFee();
    if (busy || (r && r.fee == null)) return;
    busy = true;
    try { if (await saveDraft()) egov.showSuccess('บันทึกร่างแล้ว ' + draft.draftId); } finally { busy = false; }
  });

  // ── step 2: uploads ────────────────────────────────────────
  function docName(key) { for (var i = 0; i < S.docs.length; i++) if (S.docs[i].key === key) return S.docs[i].name; return key; }
  function missingNames() {
    var have = {};
    (draft.files || []).forEach(function (f) { have[f.docKey] = true; });
    return S.docs.filter(function (d) { return d.required && !have[d.key]; }).map(function (d) { return d.name; });
  }
  function showUploadError(msg) { var u = $('upload-error'); u.textContent = msg || ''; u.hidden = !msg; }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function renderFiles() {
    document.querySelectorAll('.file-list').forEach(function (ul) { ul.textContent = ''; });
    (draft.files || []).forEach(function (f) {
      var ul = document.querySelector('.file-list[data-list-for="' + f.docKey + '"]');
      if (!ul) return;
      var li = el('li', { 'data-testid': 'file-item', 'data-name': f.name, 'data-doc-key': f.docKey, 'data-file-id': f.fileId, class: 'file-item' });
      li.appendChild(el('span', { class: 'file-name' }, f.name));
      li.appendChild(el('span', { class: 'muted' }, ' · ' + fmtSize(f.size) + ' '));
      if (draft.status === 'DRAFT') {
        var btn = el('button', { type: 'button', class: 'secondary small', 'data-testid': 'file-remove-btn', 'aria-label': 'ลบไฟล์ ' + f.name + ' (' + docName(f.docKey) + ')' }, 'ลบ');
        btn.addEventListener('click', function () { removeFile(f.fileId); });
        li.appendChild(btn);
      }
      ul.appendChild(li);
    });
    var missing = missingNames();
    var slot = $('missing-slot');
    slot.textContent = '';
    if (missing.length) slot.appendChild(el('p', { class: 'alert alert-warn', 'data-testid': 'missing-docs', role: 'status' }, 'ยังขาดเอกสาร: ' + missing.join(', ')));
    $('to-payment-btn').disabled = missing.length > 0 || draft.status !== 'DRAFT' && draft.status !== 'PENDING_PAYMENT';
  }

  async function uploadOne(key, file) {
    var fd = new FormData();
    fd.append('docKey', key);
    fd.append('file', file, file.name);
    var r = await egov.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files', fd);
    if (!r.ok) { showUploadError(errMsg(r)); return false; }
    var replaced = r.data.replaced || [];
    draft.files = (draft.files || []).filter(function (f) { return replaced.indexOf(f.fileId) < 0; });
    draft.files.push({ fileId: r.data.fileId, name: r.data.name, docKey: r.data.docKey, size: r.data.size });
    return true;
  }
  async function onPick(ev) {
    var input = ev.target;
    var key = input.getAttribute('data-doc-key');
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length || !draft.draftId) return;
    showUploadError('');
    busy = true;
    try {
      for (var i = 0; i < files.length; i++) { if (!(await uploadOne(key, files[i]))) break; }
    } catch (e) { showUploadError(S.messages.INTERNAL); }
    finally { busy = false; input.value = ''; renderFiles(); }
  }
  async function removeFile(fileId) {
    var r = await egov.api('DELETE', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files/' + encodeURIComponent(fileId));
    if (!r.ok && r.status !== 404) { egov.showError(errMsg(r)); return; }
    draft.files = (draft.files || []).filter(function (f) { return f.fileId !== fileId; });
    showUploadError('');
    renderFiles();
  }
  document.querySelectorAll('input[type=file][data-doc-key]').forEach(function (i) { i.addEventListener('change', onPick); });
  $('back-to-1').addEventListener('click', function () { setStep(1); });
  $('to-payment-btn').addEventListener('click', function () { if (!missingNames().length) setStep(3); });
  $('back-to-2').addEventListener('click', function () { setStep(2); });

  // ── step 3: payment (B06 APIs) ─────────────────────────────
  function renderPayment() {
    var box = $('pay-box');
    box.textContent = '';
    var amt = payment ? payment.amount : draft.fee;
    $('payment-amount').textContent = amt == null ? '–' : baht(amt);
    if (!payment) {
      var c = el('button', { type: 'button', 'data-testid': 'create-qr-btn', id: 'create-qr-btn' }, 'สร้าง QR');
      c.addEventListener('click', createQr);
      box.appendChild(c);
      return;
    }
    var st = payment.status;
    box.appendChild(el('p', null, 'สถานะ: ')).appendChild(
      el('span', { 'data-testid': 'payment-status', 'data-status': st, class: 'badge pay-' + st }, PAY_TH[st] || st));
    if (st === 'PAID') {
      var dl = el('dl', { class: 'kv receipt' });
      var add = function (label, node) { dl.appendChild(el('dt', null, label)); var dd = el('dd'); dd.appendChild(node); dl.appendChild(dd); };
      add('เลขคำขอ', el('strong', { 'data-testid': 'submitted-case-no' }, payment.caseNo || ''));
      add('เลขใบเสร็จ', el('span', { 'data-testid': 'receipt-no' }, payment.receiptNo || ''));
      add('ยอดชำระ', el('span', { 'data-testid': 'receipt-amount' }, baht(payment.paidAmount != null ? payment.paidAmount : payment.amount)));
      add('ชำระเมื่อ', payment.paidAt ? timeEl(payment.paidAt, 'receipt-paid-at') : el('span', { 'data-testid': 'receipt-paid-at' }, '–'));
      box.appendChild(dl);
      if (payment.caseNo) {
        var a = el('a', { class: 'btn', 'data-testid': 'go-case-btn', href: '/citizen/cases/' + encodeURIComponent(payment.caseNo) }, 'ดูคำขอ');
        box.appendChild(el('div', { class: 'actions' })).appendChild(a);
      }
      $('back-to-2').hidden = true;
      stopPoll();
      return;
    }
    var img = el('img', { 'data-testid': 'qr-image', class: 'qr', width: 200, height: 200,
      alt: 'QR PromptPay จำลอง เลขอ้างอิง ' + payment.ref + ' ยอด ' + baht(payment.amount),
      src: '/api/drafts/' + encodeURIComponent(draft.draftId) + '/qr.svg?ref=' + encodeURIComponent(payment.ref) });
    if (st === 'EXPIRED') img.className = 'qr qr-expired';
    box.appendChild(img);
    var p = el('p');
    p.appendChild(document.createTextNode('เลขอ้างอิง: '));
    p.appendChild(el('strong', { 'data-testid': 'qr-ref' }, payment.ref));
    box.appendChild(p);
    if (payment.qrExpiresAt) box.appendChild(el('p')).appendChild(timeEl(payment.qrExpiresAt, 'qr-expires', 'หมดอายุ '));
    var acts = el('div', { class: 'actions' });
    if (st === 'EXPIRED') {
      box.appendChild(el('p', { class: 'alert alert-error', 'data-testid': 'qr-expired-msg', role: 'alert' }, 'QR หมดอายุ กรุณาสร้าง QR ใหม่'));
      var re = el('button', { type: 'button', 'data-testid': 'regenerate-qr-btn' }, 'สร้าง QR ใหม่');
      re.addEventListener('click', createQr);
      acts.appendChild(re);
      stopPoll();
    } else {
      startPoll();
    }
    var rf = el('button', { type: 'button', class: 'secondary', 'data-testid': 'refresh-payment-btn' }, 'ตรวจสอบการชำระเงิน');
    rf.addEventListener('click', function () { refreshPayment(true); });
    acts.appendChild(rf);
    box.appendChild(acts);
  }

  async function createQr() {
    if (busy || !draft.draftId) return;
    busy = true;
    try {
      var r = await egov.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/payment');
      if (!r.ok) {
        if (r.data && r.data.code === 'MISSING_DOCS') { draft.missing = r.data.missing || []; setStep(2); }
        egov.showError(errMsg(r));
        return;
      }
      payment = { ref: r.data.ref, amount: r.data.amount, status: r.data.status || 'PENDING', qrCreatedAt: r.data.qrCreatedAt, qrExpiresAt: r.data.qrExpiresAt };
      draft.status = 'PENDING_PAYMENT';
      draft.fee = r.data.amount;
      showDraft();
      lockStep1();
      renderPayment();
    } finally { busy = false; }
  }

  async function refreshPayment(fromButton) {
    if (!payment) return;
    var r = await egov.api('GET', '/api/payments/' + encodeURIComponent(payment.ref));
    if (!r.ok) { if (fromButton) egov.showError(errMsg(r)); return; }
    var d = r.data;
    var next = { ref: d.ref || payment.ref, amount: d.amount != null ? d.amount : payment.amount, status: d.status,
      qrCreatedAt: d.qrCreatedAt || payment.qrCreatedAt, qrExpiresAt: d.qrExpiresAt || payment.qrExpiresAt,
      caseNo: d.caseNo || null, receiptNo: d.receiptNo || null, paidAt: d.paidAt || null, paidAmount: d.paidAmount };
    if (next.status === 'PAID' && next.caseNo && !next.paidAt) { // paidAt from the case if B06 does not echo it
      var c = await egov.api('GET', '/api/cases/' + encodeURIComponent(next.caseNo));
      if (c.ok && c.data) next.paidAt = c.data.paidAt || null;
    }
    var changed = JSON.stringify(next) !== JSON.stringify(payment);
    payment = next;
    if (changed || fromButton) renderPayment();
  }
  function startPoll() { if (!pollTimer) pollTimer = setInterval(function () { if (!document.hidden && !busy) refreshPayment(false); }, 5000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function lockStep1() {
    [qtyIn, areaIn].concat(Array.prototype.slice.call(document.querySelectorAll('[data-form-field]'))).forEach(function (i) { if (i) i.readOnly = true; });
  }

  // ── init ───────────────────────────────────────────────────
  if (draft.draftId) showDraft();
  if (draft.status !== 'DRAFT') lockStep1();
  updateFee();
  if (S.step === 2) renderFiles();
  if (S.step === 3) { renderPayment(); if (payment) refreshPayment(false); }
  else renderFiles();
})();
