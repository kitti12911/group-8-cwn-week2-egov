# BUG-HUNT · egov-eservice

Proof that our 51 Playwright tests catch the 12 bugs of `BUGS.md`. Every run = fresh `docker compose up` with
`TEST_MODE=1` (+ `BUG_MODE`), then the full suite. Made by `week-2-lab/tools/lab5-egov.sh` (no AI) and
`bughunt-egov.py`. Raw Playwright JSON per run: `bug-hunt-runs/`.

## Correct web (BUGS.md §3 steps 1 · 2 · 6)

| Run | When | Passed | Failed |
| --- | --- | --- | --- |
| normal1 | step 1 · first run | 51 | – |
| normal2 | step 2 · again, no restart | 51 | – |
| normal3 | step 6 · after all bugs | 51 | – |

## Table (BUGS.md §4)

| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
| --- | --- | --- | --- | --- | --- |
| (ปกติ) | – | – | – | – | 51/51 passed |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ 50 passed · 1 failed |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ 50 passed · 1 failed |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้มด้วย TC-RBAC-04 · TC-SLA-03) | TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 | – | – | ✅ 48 passed · 3 failed |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ 50 passed · 1 failed |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ 50 passed · 1 failed |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ 50 passed · 1 failed |
| B07 | TC-RBAC-02 (อาจล้มด้วย TC-WORKFLOW-01) | TC-RBAC-02 | – | – | ✅ 50 passed · 1 failed |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | ✅ 50 passed · 1 failed |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ 50 passed · 1 failed |
| B10 | TC-DASH-02 (อาจล้มด้วย TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – | – | ✅ 48 passed · 3 failed |
| B11 | TC-AUDIT-01 · TC-PDPA-03 | TC-AUDIT-01 · TC-PDPA-03 | – | – | ✅ 49 passed · 2 failed |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ 50 passed · 1 failed |

**Caught: 12 / 12 bugs** (all must-fail TCs fail, nothing outside the allowed list fails).

## Combined bugs (BUGS.md §3 step 5)

| BUG_MODE | Failed | Union of single runs | Same? |
| --- | --- | --- | --- |
| `B01,B05,B09` | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | ✅ |
| `B03,B07` | TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 | TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 | ✅ |

## Why each TC failed (BUGS.md §3 step 4)

First lines of the assert message. A good catch shows expected vs received, not a timeout.

| Bug | TC | Message | Kind |
| --- | --- | --- | --- |
| B01 | TC-FEE-01 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('fee-total') · Expected: "฿1,010" | value |
| B02 | TC-UPLOAD-01 | Error: expect(locator).toHaveCount(expected) failed · Locator:  locator('[data-testid="file-item"][data-name="size-5242880.pdf"]') · Expected: 1 | value |
| B03 | TC-RBAC-04 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" | value |
| B03 | TC-SLA-01 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" | value |
| B03 | TC-SLA-02 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" | value |
| B04 | TC-SLA-02 | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" | value |
| B05 | TC-PAY-01 | Error: http://localhost:3000/api/test/payments/PP-0001/pay: {"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false} · expect(received).toBe(expected) // Object.is equality · Expected: 4 | value |
| B06 | TC-RBAC-01 | Error: expect(received).toBe(expected) // Object.is equality · Expected: 404 · Received: 200 | value |
| B07 | TC-RBAC-02 | Error: http://localhost:3000/api/cases/EG-2569-000014/approve · expect(received).toBe(expected) // Object.is equality · Expected: 403 | value |
| B08 | TC-QUEUE-02 | Error: expect(received).toEqual(expected) // deep equality · - Expected  - 1 · + Received  + 1 | value |
| B09 | TC-PDPA-02 | Error: expect(received).not.toMatch(expected) · Expected pattern: not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/ · Received string:      "{\"filter\":\"all\",\"items\":[{\"caseNo\":\"EG-2569-000020\",\"serviceId\":\"SV-01\",\"appl | value |
| B10 | TC-DASH-01 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "–" | value |
| B10 | TC-DASH-02 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "85.7%" | value |
| B10 | TC-DASH-03 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "85.7%" | value |
| B11 | TC-AUDIT-01 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('audit-count') · Expected: "16" | value |
| B11 | TC-PDPA-03 | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('audit-count') · Expected: "1" | value |
| B12 | TC-WORKFLOW-04 | Error: expect(locator).toHaveCount(expected) failed · Locator:  getByTestId('return-btn') · Expected: 0 | value |
