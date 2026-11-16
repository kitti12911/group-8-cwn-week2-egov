'use strict';
// Error catalog = CONTRACT §5 (exact Thai text). API errors are {"code","message",...extra}.
// Usage:  throw new AppError('INVALID_QTY')            → 400 {"code":"INVALID_QTY","message":"จำนวนฉบับต้อง 1–5 ฉบับ"}
//         throw new AppError('MISSING_DOCS', { missing: ['แบบแปลน'] }, 'ยังขาดเอกสาร: แบบแปลน')
//         sendError(res, 'NOT_FOUND')

const CATALOG = {
  INVALID_ID: [400, 'เลขบัตรประชาชนไม่ถูกต้อง'],
  OTP_INVALID: [401, 'รหัส OTP ไม่ถูกต้อง'],
  LOCKED: [423, 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที'],
  INVALID_CREDENTIALS: [401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  INVALID_MOBILE: [400, 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0'],
  CONSENT_REQUIRED: [400, 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)'],
  INVALID_QTY: [400, 'จำนวนฉบับต้อง 1–5 ฉบับ'],
  INVALID_AREA: [400, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.'],
  AREA_TOO_LARGE: [400, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน'],
  FILE_TOO_LARGE: [400, 'ไฟล์ใหญ่เกิน 5 MB'],
  FILE_TYPE: [400, 'รองรับเฉพาะไฟล์ PDF, JPG, PNG'],
  FILE_COUNT: [400, 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ'],
  PLAN_NOT_PDF: [400, 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น'],
  MISSING_DOCS: [409, 'ยังขาดเอกสาร:'], // caller passes full message "ยังขาดเอกสาร: แบบแปลน, โฉนด"
  QR_EXPIRED: [410, 'QR หมดอายุ กรุณาสร้าง QR ใหม่'],
  AMOUNT_MISMATCH: [422, 'ยอดเงินไม่ตรงกับค่าธรรมเนียม'],
  NOT_FOUND: [404, 'ไม่พบคำขอ'],
  CANNOT_CANCEL: [409, 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว'],
  FIX_WINDOW_EXPIRED: [409, 'หมดเวลาแก้ไขแล้ว คำขอถูกยกเลิก'],
  ALREADY_CLAIMED: [409, 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว'],
  WORKLOAD_LIMIT: [409, 'รับงานได้สูงสุด 10 เรื่อง'],
  RETURN_LIMIT: [409, 'ตีกลับได้สูงสุด 2 ครั้ง'],
  REASON_TOO_SHORT: [400, 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร'],
  REASON_REQUIRED: [400, 'กรุณากรอกเหตุผล'],
  INVALID_STATE: [409, 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้'],
  FORBIDDEN: [403, 'ไม่มีสิทธิ์ทำรายการนี้'],
  FORBIDDEN_PAGE: [403, 'ไม่มีสิทธิ์เข้าถึงหน้านี้'],
  UNAUTHENTICATED: [401, 'กรุณาเข้าสู่ระบบ'],
  INVALID_FEE: [400, 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท'],
  INVALID_SLA: [400, 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ'],
  DUPLICATE_HOLIDAY: [409, 'มีวันหยุดนี้อยู่แล้ว'],
  SELF_ROLE_CHANGE: [409, 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้'],
  METHOD_NOT_ALLOWED: [405, 'Method Not Allowed'],
  // not in §5 table but used by hooks / generic handling
  INVALID_TIME: [400, 'รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น ISO พร้อม offset)'],
  BAD_REQUEST: [400, 'ข้อมูลไม่ถูกต้อง'],
  INTERNAL: [500, 'เกิดข้อผิดพลาดภายในระบบ'],
};

class AppError extends Error {
  constructor(code, extra = {}, message) {
    const [status, msg] = CATALOG[code] || [500, code];
    super(message || msg);
    this.code = code === 'FORBIDDEN_PAGE' ? 'FORBIDDEN' : code;
    this.status = status;
    this.extra = extra || {};
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.extra };
  }
}

function errorBody(code, extra, message) {
  return new AppError(code, extra, message).toJSON();
}

function sendError(res, code, extra, message) {
  const e = new AppError(code, extra, message);
  return res.status(e.status).json(e.toJSON());
}

function messageOf(code) {
  return (CATALOG[code] || [])[1];
}

module.exports = { CATALOG, AppError, errorBody, sendError, messageOf };
