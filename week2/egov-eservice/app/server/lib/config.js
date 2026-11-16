'use strict';
// Central config. Read env ONCE here; other modules import from this file.
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || path.join(ROOT, 'data', 'egov.db'),
  TEST_MODE: process.env.TEST_MODE === '1',
  BUG_MODE: process.env.BUG_MODE || '',
  // Default reset clock (CONTRACT §8, DECISIONS §0 A-01)
  DEFAULT_NOW: '2026-12-01T09:00:00+07:00',
  // Test keys (fictional; never real keys). Override with env in deploy.
  PII_KEY: process.env.PII_KEY || 'egov-test-pii-key-aes-256-gcm-do-not-use-in-prod',
  SIGN_KEY: process.env.SIGN_KEY || 'egov-test-sign-key-hmac-sha256',
  BODY_LIMIT: '6mb', // CONTRACT §0.10: must accept >= 6 MB bodies
  MAX_UPLOAD_BYTES: 5242880, // DECISIONS §4 (inclusive)
  OTP_TEST: '123456',
};
