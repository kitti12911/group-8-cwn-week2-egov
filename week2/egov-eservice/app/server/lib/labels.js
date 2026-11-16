'use strict';
// CONTRACT §2.1 / §4 code tables (Thai text exact)

const STATUS_TH = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};

const LEVEL_TH = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' };

const ROLE_TH = {
  citizen: 'ประชาชน', officer: 'เจ้าหน้าที่', head: 'หัวหน้าฝ่าย', executive: 'ผู้บริหาร',
  auditor: 'ผู้ตรวจสอบภายใน', admin: 'ผู้ดูแลระบบ',
};

const DEPT_TH = { registry: 'ฝ่ายทะเบียน', works: 'ฝ่ายโยธา', head: 'หัวหน้าฝ่าย' };

const SERVICE_NAME = { 'SV-01': 'ขอหนังสือรับรอง', 'SV-02': 'ขออนุญาตประกอบกิจการ', 'SV-03': 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร' };

const DOC_NAME = { 'id-card': 'บัตรประชาชน', map: 'แผนที่ตั้ง', 'site-photo': 'ภาพสถานที่', plan: 'แบบแปลน', deed: 'โฉนด' };

const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED']; // backlog (DECISIONS §12)
const CLOSED_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];

module.exports = { STATUS_TH, LEVEL_TH, ROLE_TH, DEPT_TH, SERVICE_NAME, DOC_NAME, OPEN_STATUSES, CLOSED_STATUSES };
