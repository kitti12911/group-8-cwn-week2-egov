'use strict';
// Append-only Audit Trail (DECISIONS §13, CONTRACT §6.8).
// audit.log({ user: req.user, event: 'CLAIM', caseNo, fromStatus, toStatus, detail })
//   or audit.log({ username: 'off.reg1', role: 'officer', event: 'STAFF_LOGIN' })
// time comes from the test clock. Never put full ID / mobile in detail.
const { db } = require('../db');
const clock = require('./clock');

const EVENTS = ['STAFF_LOGIN', 'CLAIM', 'RETURN', 'FORWARD', 'APPROVE', 'REJECT', 'ISSUE', 'UNMASK', 'EXPORT', 'ADMIN_CHANGE'];

const ins = () => db.prepare(`INSERT INTO audit_log(time, username, role, event, case_no, from_status, to_status, detail)
  VALUES (@time, @username, @role, @event, @case_no, @from_status, @to_status, @detail)`);

function log({ user, username, role, event, caseNo = null, fromStatus = null, toStatus = null, detail = '' }) {
  if (!EVENTS.includes(event)) throw new Error('unknown audit event ' + event);
  const row = {
    time: clock.nowIso(),
    username: username || (user && user.username) || 'system',
    role: role || (user && user.role) || 'system',
    event,
    case_no: caseNo || null,
    from_status: fromStatus || null,
    to_status: toStatus || null,
    detail: detail == null ? '' : String(detail),
  };
  const info = ins().run(row);
  return { id: info.lastInsertRowid, ...row };
}

/** row → API shape {id,time,username,role,event,caseNo,fromStatus,toStatus,detail} */
function toApi(r) {
  return {
    id: r.id, time: r.time, username: r.username, role: r.role, event: r.event,
    caseNo: r.case_no, fromStatus: r.from_status, toStatus: r.to_status, detail: r.detail,
  };
}

module.exports = { log, toApi, EVENTS };
