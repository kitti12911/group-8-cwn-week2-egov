# DEV · skeleton conventions (block B01)

Run: `TEST_MODE=1 docker compose up --build` → http://localhost:3000 · local: `npm install && TEST_MODE=1 npm start`
(local better-sqlite3 binary if install scripts are blocked: `cd node_modules/better-sqlite3 && npx prebuild-install`)

## Add a feature module
`server/<name>.js` with `module.exports = function register(app, ctx) { … }`. Loaded names (in order):
`auth citizen-apply payments officer documents notifications dashboard admin-audit` (missing file = skipped).
Libs (not routers): `server/rules.js` (B03), `server/seed.js` (B02: `module.exports = function seed(ctx)`, called inside the reset transaction after wipe).

`ctx` = `{ db, nextNumber, setCounter, clock, time, bugMode, audit, errors, mask, crypto, guard, sessions, hooks, upload, labels, view, config, testRouter }`

| need | use |
|---|---|
| now | `clock.now()` (Date) / `clock.nowIso()` — never `Date.now()` in rules |
| time format | `time.toIso(d)` "2026-12-04T16:30:00+07:00" (store this in DB) · `time.thaiDateTime` "4 ธ.ค. 2569 16:30" · `time.baht(1010)` "฿1,010" · `time.at(y,m,d,hh,mm)` · `time.parts(d)` · `time.beYear(d)` |
| bug | `bugMode('B03')` |
| audit | `audit.log({ user: req.user, event:'CLAIM', caseNo, fromStatus, toStatus, detail })` |
| error | `throw new errors.AppError('INVALID_QTY')` or `errors.sendError(res,'NOT_FOUND')` → `{code,message}` text of CONTRACT §5 · extra: `new AppError('OTP_INVALID',{attemptsLeft:2})` · MISSING_DOCS: pass message `new AppError('MISSING_DOCS',{missing},'ยังขาดเอกสาร: แบบแปลน, โฉนด')` |
| PII | `crypto.encrypt/decrypt` (AES-256-GCM) · `crypto.hashId(idNo)` lookup · never store plain ID/mobile · `mask.maskId` `mask.formatId` `mask.maskName` `mask.isValidThaiId` |
| password / signature | `crypto.hashPassword(username,pw)` / `verifyPassword` · `crypto.sign([docNo,caseNo,applicant,serviceId,issuedAt,validUntil,signer])` |
| numbers | `nextNumber('case', 2569)` → 31 (atomic) · seed sets `setCounter('case',2569,30)` · names: case receipt doc draft payment file |
| auth | `sessions.create(res, {type,id,username,name,role,dept,scope?})` · `sessions.destroy(req,res)` · `req.user` (snapshot at login; scope 'register' ⇒ req.user null, req.session set) |
| RBAC | `guard.page('officer','head')` (302 /login · 403 forbidden-msg) · `guard.api('citizen')` (401/403 JSON) · `guard.renderNotFound(req,res)` · `guard.landingFor(user)` |
| per-request | `hooks.onRequest(req => …)` runs before every request except /api/test/* · `hooks.onReset(fn)` |
| upload | `upload.single('file')` (memory, 8 MB cap so app answers FILE_TOO_LARGE) · `upload.sniff(buf)` magic bytes → mime |
| test hook | `ctx.testRouter.post('/payments/:ref/pay', …)` → `/api/test/payments/:ref/pay` (only TEST_MODE=1) |
| views | `<%- include('partials/head') %> … <%- include('partials/foot') %>` (header w/ nav, user-name, user-role, bell, logout) · locals: `fmt.dt/date/baht`, `timeTag(iso,testid)`, `statusTag(code)`, `levelTag(level)`, `labels`, `mask`, `esc`, `user`, `bellCount` · client `egov.api(method,url,body)`, `egov.showError(msg,testid)` |
