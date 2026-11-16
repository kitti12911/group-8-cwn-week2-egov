'use strict';
// PDPA display helpers (DECISIONS §11, §18 A-24 A-54)

/** "1101700123456" → "1-1017-00123-45-6" (citizen sees own full ID) */
function formatId(idNo) {
  const s = String(idNo || '').replace(/\D/g, '');
  if (s.length !== 13) return s;
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`;
}

/** "1101700123456" → "X-XXXX-XXXXX-45-6" (staff see last 3 digits only) */
function maskId(idNo) {
  const s = String(idNo || '').replace(/\D/g, '');
  if (s.length !== 13) return 'X-XXXX-XXXXX-XX-X';
  return `X-XXXX-XXXXX-${s.slice(10, 12)}-${s[12]}`;
}

/** "สมชาย ใจดี" → "สมชาย ใ***" (verify page / non-login views) */
function maskName(fullName) {
  const s = String(fullName || '').trim();
  const sp = s.indexOf(' ');
  if (sp < 0) return s;
  const first = s.slice(0, sp);
  const last = s.slice(sp + 1).trim();
  const ch = Array.from(last)[0] || '';
  return `${first} ${ch}***`;
}

/** Thai ID checksum (DECISIONS §2): 13 digits, d13 = (11 − Σ dᵢ×(14−i) mod 11) mod 10 */
function isValidThaiId(idNo) {
  const s = String(idNo == null ? '' : idNo);
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(s[12]);
}

module.exports = { formatId, maskId, maskName, isValidThaiId };
