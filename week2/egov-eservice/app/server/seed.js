'use strict';

// TEST-DATA §§1–12, DECISIONS §17. Called inside reset's wipe/seed transaction.
// Dates below are contractual fixtures; never recalculate them from SLA or BUG_MODE.
const iso = value => value ? value.replace(' ', 'T') + ':00+07:00' : null;
const suffix = n => String(n).padStart(6, '0');

// A real, one-page PDF with an xref table, padded to exactly 1,024 bytes.
function attachmentPdf() {
  let text = '%PDF-1.4\n';
  const offsets = [0];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 4 >>\nstream\nq\nQ\nendstream',
  ];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += 'xref\n0 5\n0000000000 65535 f \n';
  text += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n`;
  return Buffer.from(text + ' '.repeat(1024 - Buffer.byteLength(text) - 6) + '%%EOF\n');
}

module.exports = function seed(ctx) {
  const { db, crypto, setCounter } = ctx;
  function insert(table, values) {
    const keys = Object.keys(values);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => values[key]));
  }
  const baseline = iso('2026-12-01 09:00');
  const people = [
    [1, '1101700123456', 'สมชาย', 'ใจดี', '0812345678', 1],
    [2, '3100600987659', 'สมหญิง', 'รักไทย', '0823456789', 1],
    [3, '5500400111221', 'มานะ', 'ตั้งใจ', null, 0],
    [4, '1909900555015', 'ปิติ', 'มีสุข', '0834567890', 1],
  ];
  for (const [id, idNo, first, last, mobile, registered] of people) {
    insert('citizens', { id, id_hash: crypto.hashId(idNo), id_enc: crypto.encrypt(idNo),
      first_name: first, last_name: last, full_name: `${first} ${last}`,
      mobile_enc: crypto.encrypt(mobile), email: '', registered,
      consent_at: registered ? iso('2026-10-01 09:00') : null,
      registered_at: registered ? iso('2026-10-01 09:00') : null,
      created_at: iso('2026-10-01 09:00') });
  }
  const staff = [
    ['off.reg1', 'เจ้าหน้าที่ทะเบียน 1', 'officer', 'registry'],
    ['off.reg2', 'เจ้าหน้าที่ทะเบียน 2', 'officer', 'registry'],
    ['off.works1', 'เจ้าหน้าที่โยธา 1', 'officer', 'works'],
    ['head1', 'หัวหน้าฝ่าย', 'head', ''],
    ['exec1', 'ผู้บริหาร', 'executive', ''],
    ['audit1', 'ผู้ตรวจสอบภายใน', 'auditor', ''],
    ['admin1', 'ผู้ดูแลระบบ', 'admin', ''],
  ];
  staff.forEach(([username, name, role, dept], i) => insert('staff', {
    id: i + 1, username, name, role, dept, password_hash: crypto.hashPassword(username, 'Test@1234'), active: 1,
  }));
  const services = [
    ['SV-01', 'ขอหนังสือรับรอง', 20, null, 3, 'officer', ['registry']],
    ['SV-02', 'ขออนุญาตประกอบกิจการ', 500, null, 10, 'head', ['registry', 'head']],
    ['SV-03', 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร', 1000, 10, 15, 'head', ['registry', 'works', 'head']],
  ];
  services.forEach(([id, name, fee, fee_per_sqm, sla, approver, route], i) => insert('services', {
    id, name, fee, fee_per_sqm, sla, approver, route: JSON.stringify(route), sort: i + 1,
  }));
  const docs = {
    'SV-01': [['id-card', 'บัตรประชาชน', 1, 0]],
    'SV-02': [['id-card', 'บัตรประชาชน', 1, 0], ['map', 'แผนที่ตั้ง', 1, 0], ['site-photo', 'ภาพสถานที่', 0, 0]],
    'SV-03': [['id-card', 'บัตรประชาชน', 1, 0], ['plan', 'แบบแปลน', 1, 1], ['deed', 'โฉนด', 1, 0]],
  };
  for (const [service_id, entries] of Object.entries(docs)) entries.forEach(([doc_key, name, required, pdf_only], i) =>
    insert('service_docs', { service_id, doc_key, name, required, pdf_only, sort: i + 1 }));
  for (const [date, name] of [
    ['2026-12-07', 'ชดเชยวันหยุดทดสอบ (สมมติ)'],
    ['2026-12-10', 'วันรัฐธรรมนูญทดสอบ (สมมติ)'],
    ['2026-12-31', 'วันสิ้นปีทดสอบ (สมมติ)'],
    ['2027-01-01', 'วันขึ้นปีใหม่ทดสอบ (สมมติ)'],
  ]) insert('holidays', { date, name });

  // [service suffix, citizen id, qty/area, fee, status, owner, paid, due, closed]
  const rows = [
    [1,2,1,20,'COMPLETED',null,'2026-10-14 10:00','2026-10-19 16:30','2026-10-16 14:00'],
    [3,4,120,1200,'COMPLETED',null,'2026-11-02 09:00','2026-11-23 16:30','2026-11-20 11:00'],
    [1,4,2,40,'COMPLETED',null,'2026-11-02 09:30','2026-11-05 16:30','2026-11-04 15:00'],
    [2,1,null,500,'COMPLETED',null,'2026-11-02 14:00','2026-11-16 16:30','2026-11-13 15:00'],
    [1,1,1,20,'COMPLETED',null,'2026-11-03 11:00','2026-11-06 16:30','2026-11-05 10:00'],
    [2,4,null,500,'COMPLETED',null,'2026-11-03 15:00','2026-11-17 16:30','2026-11-19 10:00'],
    [2,2,null,500,'COMPLETED',null,'2026-11-04 10:00','2026-11-18 16:30','2026-11-18 16:00'],
    [1,2,1,20,'REJECTED',null,'2026-11-09 10:00','2026-11-12 16:30','2026-11-11 09:00'],
    [1,1,1,20,'CANCELLED',null,'2026-11-09 14:30','2026-11-12 16:30',null],
    [3,2,80,1000,'IN_REVIEW',null,'2026-11-12 10:00','2026-12-03 16:30',null],
    [3,1,150,1500,'PENDING_APPROVAL','head1','2026-11-16 10:00','2026-12-08 16:30',null],
    [3,4,101,1010,'IN_REVIEW','off.reg2','2026-11-18 10:00','2026-12-11 16:30',null],
    [2,1,null,500,'IN_REVIEW','off.reg2','2026-11-20 10:00','2026-12-04 16:30',null],
    [2,4,null,500,'PENDING_APPROVAL','head1','2026-11-20 11:00','2026-12-04 16:30',null],
    [2,2,null,500,'IN_REVIEW','off.reg2','2026-11-20 15:00','2026-12-04 16:30',null],
    [2,4,null,500,'IN_REVIEW','off.reg2','2026-11-23 09:00','2026-12-08 16:30',null],
    [1,1,1,20,'NEED_FIX','off.reg1','2026-11-23 10:00','2026-11-27 16:30',null],
    [2,1,null,500,'IN_REVIEW','off.reg2','2026-11-24 10:00','2026-12-09 16:30',null],
    [2,2,null,500,'APPROVED',null,'2026-11-24 14:00','2026-12-09 16:30',null],
    [1,1,1,20,'IN_REVIEW','off.reg1','2026-11-25 10:00','2026-11-30 16:30',null],
    [2,2,null,500,'IN_REVIEW','off.reg2','2026-11-25 12:00','2026-12-11 16:30',null],
    [1,2,2,40,'IN_REVIEW','off.reg1','2026-11-26 10:00','2026-12-01 16:30',null],
    [1,2,1,20,'IN_REVIEW','off.reg1','2026-11-26 10:30','2026-12-03 16:30',null],
    [1,4,1,20,'SUBMITTED',null,'2026-11-27 11:00','2026-12-02 16:30',null],
    [1,2,3,60,'IN_REVIEW','off.reg2','2026-11-30 10:00','2026-12-03 16:30',null],
    [1,1,5,100,'IN_REVIEW','off.reg2','2026-11-30 16:29','2026-12-03 16:30',null],
    [1,4,1,20,'IN_REVIEW','off.reg2','2026-11-30 16:30','2026-12-04 16:30',null],
    [1,2,1,20,'SUBMITTED',null,'2026-12-01 08:10','2026-12-04 16:30',null],
    [1,4,1,20,'SUBMITTED',null,'2026-12-01 08:20','2026-12-04 16:30',null],
    [1,1,1,20,'SUBMITTED',null,'2026-12-01 08:30','2026-12-04 16:30',null],
  ];
  const pdf = attachmentPdf();
  let fileNumber = 0;
  function attach(caseId, serviceId, createdAt) {
    for (const [doc_key, , required] of docs[serviceId]) {
      if (!required) continue;
      insert('files', { id: `F-${suffix(++fileNumber)}`, case_id: caseId, doc_key,
        name: `${doc_key}.pdf`, mime: 'application/pdf', size: pdf.length, data: pdf, created_at: createdAt });
    }
  }
  rows.forEach(([service, citizen_id, amount, fee, status, owner, paid, due, closed], index) => {
    const id = index + 1;
    const service_id = `SV-0${service}`;
    const paid_at = iso(paid);
    const isClosed = ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(status);
    const dept = isClosed || status === 'PENDING_APPROVAL' ? null : id === 10 ? 'works' : 'registry';
    const issuer = isClosed ? (id === 5 ? 'off.reg1' : null) :
      [10,11,14,19].includes(id) ? 'off.reg1' : owner;
    insert('cases', { id, draft_id: `SEED-${suffix(id)}`, case_no: `EG-2569-${suffix(id)}`,
      service_id, citizen_id, status, qty: service === 1 ? amount : null,
      area_sqm: service === 3 ? amount : null, fee, fee_locked_at: paid_at,
      step: service === 3 ? (id === 10 ? 2 : id === 11 ? 3 : 1) : null,
      dept, owner, issuer, approved_by: id === 19 ? 'head1' : id === 5 ? 'off.reg1' : null,
      approved_at: id === 19 ? iso('2026-11-30 15:00') : id === 5 ? iso(closed) : null,
      return_count: [17,23].includes(id) ? 2 : 0,
      paid_at, receipt_no: `RC-2569-${suffix(id)}`, due_at: iso(due), closed_at: iso(closed),
      returned_at: id === 17 ? iso('2026-11-27 14:00') : null,
      fix_deadline: id === 17 ? iso('2026-12-04 14:00') : null,
      cancelled_at: id === 9 ? iso('2026-11-09 15:00') : null,
      doc_no: id === 5 ? 'DOC-2569-000001' : null,
      created_at: paid_at, updated_at: id === 23 ? iso('2026-12-01 08:30') :
        id === 17 ? iso('2026-11-27 14:00') : id === 19 ? iso('2026-11-30 15:00') :
        id === 9 ? iso('2026-11-09 15:00') : iso(closed) || paid_at });
    attach(id, service_id, paid_at);
    insert('case_events', { case_id: id, time: paid_at, actor: 'system',
      from_status: 'PENDING_PAYMENT', to_status: 'SUBMITTED', note: 'ชำระเงินสำเร็จ' });
    if (status !== 'SUBMITTED') insert('case_events', { case_id: id,
      time: iso(closed) || (id === 19 ? iso('2026-11-30 15:00') : paid_at),
      actor: owner || 'system', from_status: 'SUBMITTED', to_status: status, note: '' });
    if (!isClosed || id === 5) {
      const forwarded = [10,11,14,19].includes(id);
      insert('case_handlers', { case_id: id, step: 1, dept: 'registry',
        username: forwarded ? 'off.reg1' : owner, entered_at: paid_at, left_at: forwarded ? paid_at : null });
      if ([10,11].includes(id)) insert('case_handlers', { case_id: id, step: 2, dept: 'works',
        username: id === 11 ? 'off.works1' : null, entered_at: paid_at, left_at: id === 11 ? paid_at : null });
      if ([11,14,19].includes(id)) insert('case_handlers', { case_id: id, step: 9, dept: 'head',
        username: 'head1', entered_at: paid_at, left_at: id === 19 ? iso('2026-11-30 15:00') : null });
    }
  });
  for (const [case_id, n, returned, resubmitted, paused_days, reason] of [
    [17,1,'2026-11-24 11:00','2026-11-25 10:00',1,'ภาพบัตรประชาชนไม่ชัด กรุณาถ่ายใหม่'],
    [17,2,'2026-11-27 14:00',null,null,'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข'],
    [23,1,'2026-11-27 10:00','2026-11-30 10:00',1,'ภาพเอกสารเบลอ อ่านเลขไม่ได้'],
    [23,2,'2026-11-30 14:00','2026-12-01 08:30',1,'ข้อมูลในแบบฟอร์มไม่ครบถ้วน'],
  ]) {
    insert('case_returns', { case_id, n, returned_at: iso(returned), returned_by: 'off.reg1',
      reason, resubmitted_at: iso(resubmitted), paused_days });
    insert('case_events', { case_id, time: iso(returned), actor: 'off.reg1',
      from_status: 'IN_REVIEW', to_status: 'NEED_FIX', note: reason });
    if (resubmitted) insert('case_events', { case_id, time: iso(resubmitted), actor: 'citizen',
      from_status: 'NEED_FIX', to_status: 'IN_REVIEW', note: 'ส่งเอกสารแก้ไข' });
  }
  insert('cases', { id: 31, draft_id: 'DR-0001', service_id: 'SV-01', citizen_id: 1,
    status: 'DRAFT', qty: 2, fee: 40, created_at: baseline, updated_at: baseline });
  const qrCreated = iso('2026-12-01 08:55');
  insert('cases', { id: 32, draft_id: 'DR-0002', service_id: 'SV-02', citizen_id: 1,
    status: 'PENDING_PAYMENT', fee: 500, fee_locked_at: qrCreated, created_at: qrCreated, updated_at: qrCreated });
  attach(32, 'SV-02', qrCreated);
  insert('payments', { ref: 'PP-0001', case_id: 32, amount: 500, status: 'PENDING',
    qr_created_at: qrCreated, qr_expires_at: iso('2026-12-01 09:10') });
  const document = { doc_no: 'DOC-2569-000001', case_id: 5, case_no: 'EG-2569-000005',
    verify_code: 'K7M2Q9XA', applicant: 'สมชาย ใจดี', service_id: 'SV-01',
    issued_at: iso('2026-11-05 10:00'), valid_until: '2027-02-02',
    signer: 'เจ้าหน้าที่ทะเบียน 1', issued_by: 'off.reg1' };
  document.signature = crypto.sign([document.doc_no, document.case_no, document.applicant,
    document.service_id, document.issued_at, document.valid_until, document.signer]);
  insert('documents', document);
  for (const [name, year, value] of [
    ['case',2569,30], ['receipt',2569,30], ['doc',2569,1],
    ['draft',0,2], ['payment',0,1], ['file',0,fileNumber],
  ]) setCounter(name, year, value);
  // Notifications, audit, sessions and OTP state stay empty until the first request.
};
