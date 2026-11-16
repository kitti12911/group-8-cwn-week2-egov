'use strict';
// SQLite (better-sqlite3) at DB_PATH. One connection for the whole process.
// Conventions:
//   • time columns = ISO "+07:00" strings from time.toIso() (string order == time order)
//   • PII: citizens.id_enc / mobile_enc = crypto.encrypt(); lookup by citizens.id_hash = crypto.hashId()
//   • never store plain 13-digit ID or 10-digit mobile anywhere (incl. audit.detail, notifications.text)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./lib/config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE'); // single file → easy inspection (TC-NFR-04)
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const SCHEMA = `
-- ── people ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizens (
  id           INTEGER PRIMARY KEY,
  id_hash      TEXT NOT NULL UNIQUE,      -- crypto.hashId(idNo)
  id_enc       TEXT NOT NULL,             -- crypto.encrypt(idNo)
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  full_name    TEXT NOT NULL,             -- "สมชาย ใจดี"
  mobile_enc   TEXT,                      -- crypto.encrypt(mobile)
  email        TEXT NOT NULL DEFAULT '',
  registered   INTEGER NOT NULL DEFAULT 0,
  consent_at   TEXT,
  registered_at TEXT,
  created_at   TEXT
);
CREATE TABLE IF NOT EXISTS otp_state (       -- wiped on reset (CONTRACT §0.9)
  id_hash      TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  otp_sent_at  TEXT
);
CREATE TABLE IF NOT EXISTS staff (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,      -- off.reg1
  password_hash TEXT NOT NULL,            -- crypto.hashPassword(username, pw)
  name         TEXT NOT NULL,             -- เจ้าหน้าที่ทะเบียน 1
  role         TEXT NOT NULL CHECK (role IN ('officer','head','executive','auditor','admin')),
  dept         TEXT NOT NULL DEFAULT '',  -- registry | works | ''
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (        -- wiped on reset → everyone must log in again
  sid          TEXT PRIMARY KEY,
  data         TEXT NOT NULL,             -- JSON snapshot {type,id,username,name,role,dept,scope}
  created_at   TEXT NOT NULL
);

-- ── catalog ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,          -- SV-01
  name         TEXT NOT NULL,
  fee          INTEGER NOT NULL DEFAULT 0, -- SV-01 per copy · SV-02 flat · SV-03 base (feeBase)
  fee_per_sqm  INTEGER,                   -- SV-03 only
  sla          INTEGER NOT NULL,          -- working days
  approver     TEXT NOT NULL CHECK (approver IN ('officer','head')),
  route        TEXT NOT NULL,             -- JSON e.g. ["registry","works","head"]
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS service_docs (
  service_id   TEXT NOT NULL REFERENCES services(id),
  doc_key      TEXT NOT NULL,             -- id-card | map | site-photo | plan | deed
  name         TEXT NOT NULL,             -- บัตรประชาชน
  required     INTEGER NOT NULL DEFAULT 1,
  pdf_only     INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, doc_key)
);
CREATE TABLE IF NOT EXISTS holidays (
  date         TEXT PRIMARY KEY,          -- YYYY-MM-DD
  name         TEXT NOT NULL
);

-- ── applications (draft → case) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id            INTEGER PRIMARY KEY,
  draft_id      TEXT NOT NULL UNIQUE,     -- DR-0001 (seeded cases may use any unique value)
  case_no       TEXT UNIQUE,              -- EG-2569-000001 (assigned on payment)
  service_id    TEXT NOT NULL REFERENCES services(id),
  citizen_id    INTEGER NOT NULL REFERENCES citizens(id),
  status        TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_PAYMENT','SUBMITTED','IN_REVIEW','NEED_FIX','PENDING_APPROVAL','APPROVED','COMPLETED','REJECTED','CANCELLED')),
  qty           INTEGER,                  -- SV-01
  area_sqm      INTEGER,                  -- SV-03
  form          TEXT NOT NULL DEFAULT '{}', -- JSON of other form fields
  fee           INTEGER,                  -- current / locked fee
  fee_locked_at TEXT,                     -- set when entering PENDING_PAYMENT (A-42)
  step          INTEGER,                  -- SV-03: 1..3 · others NULL
  dept          TEXT,                     -- queue dept: registry | works | NULL (head / closed)
  owner         TEXT,                     -- staff username holding the case
  issuer        TEXT,                     -- staff username who will press "ออกเอกสาร" (A-27)
  approved_by   TEXT,
  approved_at   TEXT,
  return_count  INTEGER NOT NULL DEFAULT 0,
  paid_at       TEXT,
  receipt_no    TEXT UNIQUE,              -- RC-2569-000001
  due_at        TEXT,                     -- computed once at payment, extended on resubmit
  returned_at   TEXT,                     -- last return time (while NEED_FIX)
  fix_deadline  TEXT,                     -- returned_at + 168 h
  closed_at     TEXT,                     -- COMPLETED/REJECTED time
  cancelled_at  TEXT,
  reject_reason TEXT,
  doc_no        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0 -- draft deleted by citizen
);
CREATE INDEX IF NOT EXISTS ix_cases_citizen ON cases(citizen_id);
CREATE INDEX IF NOT EXISTS ix_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS case_handlers (   -- who handled which step (file access BR-29, issuer, notifications)
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  step         INTEGER NOT NULL,          -- 1 registry · 2 works (SV-03) · 9 head
  dept         TEXT NOT NULL,             -- registry | works | head
  username     TEXT,                      -- holder at that step (NULL until claimed)
  entered_at   TEXT NOT NULL,
  left_at      TEXT,
  PRIMARY KEY (case_id, step)
);
CREATE TABLE IF NOT EXISTS case_events (     -- citizen/officer timeline
  id           INTEGER PRIMARY KEY,
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  time         TEXT NOT NULL,
  actor        TEXT,                      -- username / 'citizen' / 'system'
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS case_returns (    -- return history (≤ 2 per case)
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  n            INTEGER NOT NULL,
  returned_at  TEXT NOT NULL,
  returned_by  TEXT,
  reason       TEXT NOT NULL,
  resubmitted_at TEXT,
  paused_days  INTEGER,
  PRIMARY KEY (case_id, n)
);
CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,          -- F-000001
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  doc_key      TEXT NOT NULL,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL,             -- application/pdf | image/jpeg | image/png
  size         INTEGER NOT NULL,
  data         BLOB NOT NULL,             -- stored in DB → reset removes uploads
  created_at   TEXT NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_files_case ON files(case_id);

-- ── payments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  ref          TEXT PRIMARY KEY,          -- PP-0001
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PENDING','PAID','EXPIRED','VOID')),
  qr_created_at TEXT NOT NULL,
  qr_expires_at TEXT NOT NULL,            -- created + 15:00
  paid_at      TEXT,
  paid_amount  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_payments_case ON payments(case_id);

-- ── documents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  doc_no       TEXT PRIMARY KEY,          -- DOC-2569-000001
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  case_no      TEXT NOT NULL,
  verify_code  TEXT NOT NULL UNIQUE,      -- 8 chars e.g. K7M2Q9XA
  applicant    TEXT NOT NULL,             -- full name (signed field)
  service_id   TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  valid_until  TEXT NOT NULL,             -- YYYY-MM-DD (last valid day)
  signer       TEXT NOT NULL,             -- display name of approver
  issued_by    TEXT,                      -- username who pressed issue
  signature    TEXT NOT NULL              -- crypto.sign([docNo,caseNo,applicant,serviceId,issuedAt,validUntil,signer])
);

-- ── notifications (bell) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL,
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  case_no      TEXT NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('near','overdue')),
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  read_at      TEXT,
  UNIQUE (username, case_id, level)       -- 1 per level per case per person
);

-- ── audit (append-only) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY,
  time         TEXT NOT NULL,
  username     TEXT NOT NULL,
  role         TEXT NOT NULL,
  event        TEXT NOT NULL CHECK (event IN ('STAFF_LOGIN','CLAIM','RETURN','FORWARD','APPROVE','REJECT','ISSUE','UNMASK','EXPORT','ADMIN_CHANGE')),
  case_no      TEXT,
  from_status  TEXT,
  to_status    TEXT,
  detail       TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- ── running numbers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counters (
  name         TEXT NOT NULL,             -- case | receipt | doc | draft | payment | file
  year         INTEGER NOT NULL DEFAULT 0, -- BE year for case/receipt/doc · 0 for global
  value        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
);
CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT
);
`;

db.exec(SCHEMA);

// Wipe order respects foreign keys (children first).
const TABLES = [
  'notifications', 'audit_log', 'documents', 'payments', 'files', 'case_returns', 'case_events',
  'case_handlers', 'cases', 'service_docs', 'services', 'holidays', 'sessions', 'otp_state',
  'staff', 'citizens', 'counters', 'settings',
];

/** Delete all rows of every table (schema kept → prepared statements stay valid). */
function wipe() {
  db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.exec(SCHEMA); // recreates triggers
}

/**
 * Next running number, atomic inside the caller's transaction (better-sqlite3 is synchronous,
 * so two concurrent HTTP requests can never get the same value).
 * nextNumber('case', 2569) → 31
 */
function nextNumber(name, year = 0) {
  db.prepare('INSERT OR IGNORE INTO counters(name, year, value) VALUES (?, ?, 0)').run(name, year);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ? AND year = ?').run(name, year);
  return db.prepare('SELECT value FROM counters WHERE name = ? AND year = ?').get(name, year).value;
}

/** Set a counter so the NEXT number is value+1 (used by seed). */
function setCounter(name, year, value) {
  db.prepare('INSERT INTO counters(name, year, value) VALUES (?, ?, ?) ON CONFLICT(name, year) DO UPDATE SET value = excluded.value')
    .run(name, year, value);
}

module.exports = { db, wipe, nextNumber, setCounter, TABLES, SCHEMA };
