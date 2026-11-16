# TEST-REPORT · e-Service เทศบาลนครตัวอย่าง (51 TC + BUG_MODE B01–B12)

Block B14 (integration) · 2026-11-16 · Playwright 1.65.1 (chromium headless shell) · Node 22 (local) / Node 20 (Docker image) · workers=1 (RESET is global)

**Result:** with `TEST_MODE=1` and no `BUG_MODE`, **51/51 pass**. That holds for 3 local runs, including a second run straight after the first with no restart, and for 2 runs against `docker compose up`. **Each of B01–B12 makes exactly the TC listed in BUGS.md §2 fail.** Every extra failure is in that bug's "may also fail" list. Both combinations fail as the union of their parts, and the web passes 51/51 again once all bugs are turned off.

## How to reproduce

```bash
# web (one command) · DB is written to ./data/egov.db on the host (TC-NFR-04 reads it)
TEST_MODE=1 docker compose up -d --build              # bug run: TEST_MODE=1 BUG_MODE=B03 docker compose up -d
# optional 2nd web without TEST_MODE (TC-NFR-03 checks /api/test/* → 404)
docker run -d --rm --name egov-nontest -p 3001:3000 egov-eservice:local

npm install            # includes devDeps @playwright/test @axe-core/playwright exceljs pdf-parse
DB_PATH=$PWD/data/egov.db NON_TEST_BASE_URL=http://localhost:3001 ENCRYPTION_METHOD=AES-256-GCM npx playwright test --reporter=list
#   expected: 51 passed
# PW_CHROMIUM_PATH=<chromium binary> uses a browser that is already installed (this sandbox: /opt/ms-playwright/chromium_headless_shell-1254/…)
```

Without Docker: `TEST_MODE=1 BUG_MODE=<code> DB_PATH=/tmp/egov.db PORT=3000 node server/index.js`. The server restarts with an empty DB for each BUG_MODE, and every TC begins with `POST /api/test/reset`.
Raw evidence (list output + Playwright JSON for each run) is in `test-evidence/` (`normal1..3`, `docker1..2`, `bug_<code>`).

## Table 1 · Full 51-TC run, correct web (`TEST_MODE=1`, no `BUG_MODE`)

| Run | Passed | Failed | Total time |
|---|---|---|---|
| normal1 | 51/51 | – | 82 s |
| normal2 | 51/51 | – | 81 s |
| normal3 | 51/51 | – | 76 s |
| docker1 | 51/51 | – | 74 s |
| docker2 | 51/51 | – | 73 s |

normal1 = local, first run · normal2 = immediately after, no web restart (BUGS.md §3 step 2) · normal3 = after the whole BUG series, all bugs off (step 6) · docker1/2 = `TEST_MODE=1 docker compose up`, two runs in a row

| # | TC | ชื่อ | local รอบ 1 | local รอบ 2 (ไม่ restart) | local รอบ 3 (หลังชุด BUG) | docker รอบ 1 | docker รอบ 2 |
|---|---|---|---|---|---|---|---|
| 1 | TC-AUTH-01 | เลขบัตร 13 หลัก + checksum | ✅ 1.2s | ✅ 1.2s | ✅ 1.1s | ✅ 1.1s | ✅ 1.2s |
| 2 | TC-AUTH-02 | OTP ผิด 3 ครั้งล็อก 15 นาที | ✅ 1.8s | ✅ 1.8s | ✅ 1.7s | ✅ 1.7s | ✅ 1.7s |
| 3 | TC-AUTH-03 | ลงทะเบียนครั้งแรก | ✅ 3.5s | ✅ 3.7s | ✅ 3.6s | ✅ 3.6s | ✅ 3.6s |
| 4 | TC-AUTH-04 | เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้นตามบทบาท | ✅ 4.7s | ✅ 4.7s | ✅ 4.8s | ✅ 4.6s | ✅ 4.6s |
| 5 | TC-FEE-01 | ค่าธรรมเนียม SV-01/SV-02/SV-03 | ✅ 0.7s | ✅ 0.7s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s |
| 6 | TC-SUBMIT-01 | ยื่นคำขอ SV-01 ครบวงจร | ✅ 0.8s | ✅ 0.8s | ✅ 0.8s | ✅ 0.7s | ✅ 0.7s |
| 7 | TC-SUBMIT-02 | เอกสารบังคับครบก่อนชำระ | ✅ 0.7s | ✅ 0.7s | ✅ 0.7s | ✅ 0.7s | ✅ 0.6s |
| 8 | TC-SUBMIT-03 | ร่าง การลบร่าง และการยกเลิก | ✅ 2.0s | ✅ 2.3s | ✅ 2.0s | ✅ 1.9s | ✅ 1.9s |
| 9 | TC-UPLOAD-01 | ขนาดและจำนวนไฟล์ | ✅ 1.6s | ✅ 1.7s | ✅ 1.6s | ✅ 1.6s | ✅ 1.6s |
| 10 | TC-UPLOAD-02 | ชนิดไฟล์จากเนื้อไฟล์ | ✅ 0.7s | ✅ 0.8s | ✅ 0.8s | ✅ 0.7s | ✅ 0.7s |
| 11 | TC-PAY-01 | อายุ QR 15:00 | ✅ 1.3s | ✅ 1.4s | ✅ 1.3s | ✅ 1.2s | ✅ 1.2s |
| 12 | TC-PAY-02 | ยอดเงินและ callback ซ้ำ | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s | ✅ 0.2s | ✅ 0.3s |
| 13 | TC-PAY-03 | ชำระพร้อมกัน เลขไม่ซ้ำ | ✅ 0.4s | ✅ 0.5s | ✅ 0.4s | ✅ 0.4s | ✅ 0.4s |
| 14 | TC-PAY-04 | เลขคำขอข้ามปี 2569 → 2570 | ✅ 0.5s | ✅ 0.4s | ✅ 0.4s | ✅ 0.3s | ✅ 0.3s |
| 15 | TC-QUEUE-01 | ลำดับคิวและขอบเขตแผนก | ✅ 0.8s | ✅ 0.8s | ✅ 0.8s | ✅ 0.7s | ✅ 0.7s |
| 16 | TC-QUEUE-02 | รับเรื่องซ้อน พร้อมกันและต่อกัน | ✅ 1.3s | ✅ 1.4s | ✅ 1.3s | ✅ 1.2s | ✅ 1.2s |
| 17 | TC-QUEUE-03 | งานในมือสูงสุด 10 | ✅ 1.3s | ✅ 1.2s | ✅ 1.2s | ✅ 1.2s | ✅ 1.2s |
| 18 | TC-SLA-01 | กำหนดเสร็จตามตารางวันที่ | ✅ 3.2s | ✅ 3.0s | ✅ 3.0s | ✅ 2.8s | ✅ 2.7s |
| 19 | TC-SLA-02 | หยุดนับ SLA ระหว่างรอแก้ไข | ✅ 2.2s | ✅ 2.0s | ✅ 2.0s | ✅ 1.8s | ✅ 1.8s |
| 20 | TC-SLA-03 | ระดับเตือน ปกติ/ใกล้/เกิน | ✅ 1.8s | ✅ 1.6s | ✅ 1.5s | ✅ 1.5s | ✅ 1.5s |
| 21 | TC-NOTI-01 | ผู้รับแจ้งเตือนตามระดับ | ✅ 0.8s | ✅ 0.8s | ✅ 0.8s | ✅ 0.7s | ✅ 0.7s |
| 22 | TC-NOTI-02 | ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร | ✅ 2.7s | ✅ 2.5s | ✅ 2.5s | ✅ 2.5s | ✅ 2.4s |
| 23 | TC-WORKFLOW-01 | SV-01 อนุมัติ + ออกเอกสาร | ✅ 0.9s | ✅ 0.7s | ✅ 0.8s | ✅ 0.8s | ✅ 0.7s |
| 24 | TC-WORKFLOW-02 | SV-02 ผ่านหัวหน้า | ✅ 1.5s | ✅ 1.4s | ✅ 1.4s | ✅ 1.3s | ✅ 1.4s |
| 25 | TC-WORKFLOW-03 | SV-03 สามขั้นตอน | ✅ 1.2s | ✅ 1.1s | ✅ 1.1s | ✅ 1.1s | ✅ 1.1s |
| 26 | TC-WORKFLOW-04 | ตีกลับสูงสุด 2 ครั้ง และผลหลังครบ | ✅ 2.4s | ✅ 2.5s | ✅ 2.4s | ✅ 2.3s | ✅ 2.3s |
| 27 | TC-WORKFLOW-05 | เหตุผล ≥ 10 ตัวอักษร (ตีกลับ/ไม่อนุมัติ) | ✅ 1.7s | ✅ 1.8s | ✅ 1.6s | ✅ 1.6s | ✅ 1.6s |
| 28 | TC-WORKFLOW-06 | เวลาแก้ไข 168 ชั่วโมง | ✅ 1.1s | ✅ 1.1s | ✅ 0.9s | ✅ 0.9s | ✅ 0.9s |
| 29 | TC-DOC-01 | ออกเอกสารและข้อมูลใน PDF | ✅ 0.6s | ✅ 0.6s | ✅ 0.5s | ✅ 0.5s | ✅ 0.5s |
| 30 | TC-DOC-02 | ตรวจเอกสาร /verify | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s |
| 31 | TC-DOC-03 | เอกสารหมดอายุและลายเซ็นไม่ตรง | ✅ 2.0s | ✅ 2.0s | ✅ 1.8s | ✅ 1.7s | ✅ 1.7s |
| 32 | TC-PDPA-01 | ปิดบังเลขบัตรบนจอ | ✅ 0.7s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s |
| 33 | TC-PDPA-02 | API JSON ไม่ส่งเลขบัตรเต็ม | ✅ 0.4s | ✅ 0.4s | ✅ 0.4s | ✅ 0.3s | ✅ 0.4s |
| 34 | TC-PDPA-03 | แสดงเลขเต็มต้องมีเหตุผลและ Audit | ✅ 0.9s | ✅ 0.9s | ✅ 0.8s | ✅ 0.8s | ✅ 0.8s |
| 35 | TC-DASH-01 | Dashboard ตัวเลขเริ่มต้น | ✅ 0.7s | ✅ 0.5s | ✅ 0.5s | ✅ 0.5s | ✅ 0.5s |
| 36 | TC-DASH-02 | Dashboard ย้อนหลัง พ.ย. ต.ค. รายปี | ✅ 0.8s | ✅ 0.7s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s |
| 37 | TC-DASH-03 | ส่งออก Excel/PDF เท่าหน้าจอ และไม่มีข้อมูลส่วนบุคคล | ✅ 1.7s | ✅ 1.2s | ✅ 1.2s | ✅ 1.2s | ✅ 1.1s |
| 38 | TC-DASH-04 | ค่าขอบทันกำหนด 16:29:59 / 16:30:00 / 16:30:01 | ✅ 0.8s | ✅ 0.7s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s |
| 39 | TC-AUDIT-01 | เหตุการณ์และฟิลด์ใน Audit | ✅ 1.7s | ✅ 1.5s | ✅ 1.4s | ✅ 1.3s | ✅ 1.3s |
| 40 | TC-AUDIT-02 | Audit แก้/ลบไม่ได้ (405) | ✅ 0.5s | ✅ 0.4s | ✅ 0.4s | ✅ 0.3s | ✅ 0.4s |
| 41 | TC-AUDIT-03 | กรองช่วงวันที่ตามเวลาไทย | ✅ 1.5s | ✅ 1.4s | ✅ 1.3s | ✅ 1.3s | ✅ 1.2s |
| 42 | TC-RBAC-01 | ประชาชนเปิดคำขอคนอื่นไม่ได้ (IDOR) | ✅ 0.4s | ✅ 0.4s | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s |
| 43 | TC-RBAC-02 | เจ้าหน้าที่อนุมัติ SV-02 ไม่ได้ (API) | ✅ 0.7s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s | ✅ 0.6s |
| 44 | TC-RBAC-03 | ตารางสิทธิ์หน้า/API ตามบทบาท | ✅ 4.3s | ✅ 4.2s | ✅ 4.0s | ✅ 3.8s | ✅ 3.8s |
| 45 | TC-RBAC-04 | ผู้ดูแลระบบ: บริการ วันหยุด ผู้ใช้ และยอดที่ล็อก | ✅ 1.3s | ✅ 1.3s | ✅ 1.2s | ✅ 1.2s | ✅ 1.1s |
| 46 | TC-RBAC-05 | สิทธิ์เปิด/ดาวน์โหลดไฟล์แนบ | ✅ 6.1s | ✅ 6.0s | ✅ 6.0s | ✅ 6.0s | ✅ 5.9s |
| 47 | TC-RBAC-06 | ผู้ดูแลระบบ: ช่วงค่าที่ยอมรับ | ✅ 1.3s | ✅ 1.3s | ✅ 1.2s | ✅ 1.2s | ✅ 1.2s |
| 48 | TC-NFR-01 | Responsive 375/768/1280 | ✅ 2.8s | ✅ 2.6s | ✅ 2.4s | ✅ 2.4s | ✅ 2.5s |
| 49 | TC-NFR-02 | WCAG axe คีย์บอร์ด label และข้อความสถานะ | ✅ 6.6s | ✅ 7.1s | ✅ 6.1s | ✅ 6.0s | ✅ 6.0s |
| 50 | TC-NFR-03 | Health เวลาโหลด และผลซ้ำได้ | ✅ 1.4s | ✅ 1.5s | ✅ 1.4s | ✅ 1.3s | ✅ 1.3s |
| 51 | TC-NFR-04 | เข้ารหัสข้อมูลส่วนบุคคลที่เก็บ (inspection) | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s | ✅ 0.3s |
| | **รวม** | | **51/51** | **51/51** | **51/51** | **51/51** | **51/51** |

## Table 2 · BUG_MODE results (BUGS.md §4)

Each row: restart the web with `TEST_MODE=1 BUG_MODE=<code>`, then run **all 51 TC**.

| Bug | TC expected to fail (from table 2) | TC that actually failed | Failed beyond expected | Should fail but passed | Result |
|---|---|---|---|---|---|
| (normal) | – | – | – | – | ✅ 51/51 passed (×3 local, ×2 docker) |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ 50 passed · 1 failed |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ 50 passed · 1 failed |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-04 | TC-RBAC-04 (อยู่ในรายการอาจล้ม) | – | ✅ 48 passed · 3 failed |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ 50 passed · 1 failed |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ 50 passed · 1 failed |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ 50 passed · 1 failed |
| B07 | TC-RBAC-02 (อาจล้ม: TC-WORKFLOW-01) | TC-RBAC-02 | – | – | ✅ 50 passed · 1 failed |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | ✅ 50 passed · 1 failed |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ 50 passed · 1 failed |
| B10 | TC-DASH-02 (อาจล้ม: TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | TC-DASH-01 · TC-DASH-03 (อยู่ในรายการอาจล้ม) | – | ✅ 48 passed · 3 failed |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | ✅ 49 passed · 2 failed |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ 50 passed · 1 failed |
| B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-WORKFLOW-01) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 · TC-RBAC-04 | TC-RBAC-04 (อยู่ในรายการอาจล้ม) | – | ✅ 47 passed · 4 failed |
| B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | ✅ 48 passed · 3 failed |

Bug runs B01–B12 used the local server (same code). B01 was also run once through docker compose (log `BUG_MODE=B01` → TC-FEE-01 expected `฿1,010` received `฿1,000`). This confirms compose passes the variable into the container.

### Failure messages (BUGS.md §3 step 4: real values differ from expected; none are timeouts)

| Bug | TC | First assertion that failed |
|---|---|---|
| B01 | TC-FEE-01 | Error: expect(locator).toHaveText(expected) failed · Expected: "฿1,010" · Received: "฿1,000" · - Expect "toHaveText" getByTestId('fee-total') with timeout 10000ms |
| B02 | TC-UPLOAD-01 | Error: expect(locator).toHaveCount(expected) failed · Expected: 1 · Received: 0 · - Expect "toHaveCount" locator('[data-testid="file-item"][data-name="size-5242880.pdf"]') with timeout 10000ms |
| B03 | TC-SLA-01 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03 | TC-SLA-02 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03 | TC-RBAC-04 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" |
| B04 | TC-SLA-02 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" |
| B05 | TC-PAY-01 | Error: http://localhost:3000/api/test/payments/PP-0001/pay: {"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false} · expect(received).toBe(expected) // Object.is equality · Expected: 410 · Received: 200 |
| B06 | TC-RBAC-01 | Error: expect(received).toBe(expected) // Object.is equality · Expected: 404 · Received: 200 |
| B07 | TC-RBAC-02 | Error: http://localhost:3000/api/cases/EG-2569-000014/approve · expect(received).toBe(expected) // Object.is equality · Expected: 403 · Received: 200 |
| B08 | TC-QUEUE-02 | Error: expect(received).toEqual(expected) // deep equality · - Expected  - 1 · + Received  + 1 · -   409, |
| B09 | TC-PDPA-02 | Error: expect(received).not.toMatch(expected) · Expected pattern: not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/ · Received string:      "{\"filter\":\"all\",\"items\":[{\"caseNo\":\"EG-2569-000020\",\"serviceId\":\"SV-01\",\"applicantName\":\"สมชาย ใจดี\",\"idMasked\": |
| B10 | TC-DASH-01 | Error: expect(locator).toHaveText(expected) failed · Expected: "–" · Received: "0.0%" · - Expect "toHaveText" getByTestId('kpi-ontime-pct') with timeout 10000ms |
| B10 | TC-DASH-02 | Error: expect(locator).toHaveText(expected) failed · Expected: "85.7%" · Received: "23.1%" · - Expect "toHaveText" getByTestId('kpi-ontime-pct') with timeout 10000ms |
| B10 | TC-DASH-03 | Error: expect(locator).toHaveText(expected) failed · Expected: "85.7%" · Received: "23.1%" · - Expect "toHaveText" getByTestId('kpi-ontime-pct') with timeout 10000ms |
| B11 | TC-PDPA-03 | Error: expect(locator).toHaveText(expected) failed · Expected: "1" · Received: "0" · - Expect "toHaveText" getByTestId('audit-count') with timeout 10000ms |
| B11 | TC-AUDIT-01 | Error: expect(locator).toHaveText(expected) failed · Expected: "16" · Received: "15" · - Expect "toHaveText" getByTestId('audit-count') with timeout 10000ms |
| B12 | TC-WORKFLOW-04 | Error: expect(locator).toHaveCount(expected) failed · Expected: 0 · Received: 1 · - Expect "toHaveCount" getByTestId('return-btn') with timeout 10000ms |
| B03,B07 | TC-SLA-01 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03,B07 | TC-SLA-02 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03,B07 | TC-RBAC-02 | Error: http://localhost:3000/api/cases/EG-2569-000014/approve · expect(received).toBe(expected) // Object.is equality · Expected: 403 · Received: 200 |
| B03,B07 | TC-RBAC-04 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" |
| B01,B05,B09 | TC-FEE-01 | Error: expect(locator).toHaveText(expected) failed · Expected: "฿1,010" · Received: "฿1,000" · - Expect "toHaveText" getByTestId('fee-total') with timeout 10000ms |
| B01,B05,B09 | TC-PAY-01 | Error: http://localhost:3000/api/test/payments/PP-0001/pay: {"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false} · expect(received).toBe(expected) // Object.is equality · Expected: 410 · Received: 200 |
| B01,B05,B09 | TC-PDPA-02 | Error: expect(received).not.toMatch(expected) · Expected pattern: not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/ · Received string:      "{\"filter\":\"all\",\"items\":[{\"caseNo\":\"EG-2569-000020\",\"serviceId\":\"SV-01\",\"applicantName\":\"สมชาย ใจดี\",\"idMasked\": |

## What B14 fixed during integration (fixes are in the web; no expected values were changed)

| Problem found | Cause | Fix |
|---|---|---|
| First run had `/api/test/reset` → 500 on all 51 TC | an old server process still held port 3000 and the DB file had been deleted (environment issue) | runs now use a pid file (not a web bug) |
| TC-WORKFLOW-04 (and other audit filters) read stale rows | `/audit` refreshes over fetch, and before the response arrived the old unfiltered rows were still on screen (strict-mode: 3 `audit-detail` rows) | `views/audit.ejs`: on submit, clear the old rows and `audit-count` immediately, set `aria-busy`, and only the latest request may repaint (seq guard) |
| TC-NFR-02 `row-status needs a machine-readable code` | `views/officer-queue.ejs` had no `data-status` | added `data-status="<%= r.status %>"` |
| TC-DASH-03 timeout on `waitForResponse(format=pdf)` | navigating to an `<a download>` does not raise a response event in Chromium/Playwright | `views/dashboard.ejs`: the export buttons fetch the file and hand it to the browser as a blob download with the server's filename. The `href` stays as a fallback when JS is off, and errors show in `action-error` |
| B03 made TC-NOTI-02 fail too (not in the allowed list) | the B03-bugged working-day function was also used to count "days remaining" for SLA levels, so case 16 lost its `near` level on 5 Dec | `server/rules.js` `daysRemaining` ignores B03, so B03 now only affects due-date calculation (computeDueAt / extendDueOnResubmit) per BUGS.md rule 1 · `server/rules.test.js` updated (16/16 pass) |
| TC-DASH-03 needs `pdf-parse` | missing dependency | `package.json` devDependencies + `pdf-parse@^2.4.5` |
| Docker image had no Thai font, so PDFs had only the ASCII line | `node:20-bookworm-slim` has no TTF | `Dockerfile` installs `fonts-tlwg-garuda-ttf fonts-tlwg-loma-ttf` (documents.js/dashboard.js read from `/usr/share/fonts/truetype/tlwg`) |
| Playwright on a machine whose browser version doesn't match the runner | – | `playwright.config.ts` accepts `PW_CHROMIUM_PATH` (executablePath) and `PW_JSON` (optional; nothing changes if unset) |

## Questions / problems in the brief

1. **B03 and TC-SLA-03 / TC-NOTI-02:** BUGS.md §2 says the bugged "working-day" function may also be used to count remaining days, so TC-SLA-03 may fail. But SLA levels also drive notifications, so TC-NOTI-02 fails too (case `…000016` on 5 Dec 10:00 for off.reg2 should be `near`), and NOTI-02 is not in the "may also fail" list. We scoped B03 to due-date calculation only, so B03 now fails only SLA-01, SLA-02 and RBAC-04. If the brief intends levels to use the bugged function too, add TC-NOTI-02 to "may also fail" (`test-evidence/bug_B03_v1.*` is the run before the change: SLA-01 SLA-02 SLA-03 NOTI-02 RBAC-04).
2. **TC-DASH-03 / download assertions:** the TEST-PLAN wants Content-Type `application/pdf` checked, but in Playwright an `<a download>` navigation produces no response event. Either the web has to download via fetch (what we did), or the test should read the header from `request.get()`. The brief doesn't say which.
3. **TC-AUTH-02 (B04 note):** the test reads `response.text()` after the page has already navigated, so it is fragile. auth.js delays navigation 300 ms after a successful login to keep it stable. Better to fix the test so it reads the body before navigation.
4. **TC-UPLOAD-01 under B02:** the failure message is `file-item … count expected 1 received 0` (a count, not the text `ไฟล์ใหญ่เกิน 5 MB`). It is still a value-vs-expected failure, not a timeout, but the triage example in BUGS.md §3 step 4 expects a message that shows the value.
5. **TC-NFR-04** requires `DB_PATH` from the tester (the brief doesn't name the variable) · `ENCRYPTION_METHOD` is only evidence text (here: AES-256-GCM via `server/lib/crypto.js`).
6. Environment: in this sandbox `docker pull` fails because `~/.docker/config.json` has `credsStore` pointing at a helper that doesn't exist. Use `DOCKER_CONFIG=<dir with {}>`. Docker Hub itself is reachable (this is not a web problem).
