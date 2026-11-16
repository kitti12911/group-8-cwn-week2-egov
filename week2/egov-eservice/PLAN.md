# PLAN · egov-eservice

**Goal:** Central e-Service web for a fictional city, built to /workspace/egov-brief (REQUIREMENTS CONTRACT TEST-DATA DECISIONS), Docker Compose one command, TEST_MODE=1 + BUG_MODE per BUGS.md, Playwright for all 51 TC in TEST-PLAN

Made 2026-11-16 17:44 · max agents 4 · quota: real quota (team.py quota) · time factor k: none yet (k = 1)

> Plan only. Nothing ran. KC-QUEST picked accounts from quota and simulated the timing.

## 1. Accounts

| account | 5 h used | week used | week resets in (h) | slots | source |
| --- | --- | --- | --- | --- | --- |
| yolo1 | 54% | 58% | 7.3 | 4 | real |
| yolo2 | 54% | 58% | 7.2 | 4 | real |
| cyolo1 | 10% | 2% | 163.7 | 3 | real |

## 2. DAG

![DAG](dag.png)

**Critical path:** B01 → B03 → B05 → B06 → B14 · 12M tok

## 3. Who does what, when

![Gantt](gantt-plan.png)

| block | skill | title | size · M tok | waits for | rank | accounts (role) | start–end min | KC-QUEST reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B01 | yolo | Skeleton + compose + DB + test hooks | L · 3 | – | 12 | yolo1 (do) | 0.0–25.0 | yolo1 51.9 (U=0.768 F=0.023 R=0.382 V=1.0 L=0.0) · cap 50.98M · 5h 7.8% / week 0.98% · 2nd yolo2 51.9 |
| B02 | cyolo | Seed data from TEST-DATA | M · 1.5 | B01 | 6 | cyolo1 (do) | 25.0–43.8 | cyolo1 14.4 (U=0.128 F=0.005 R=0.705 V=0.35 L=0.667) · cap 39.2M · 5h 3.9% / week 0.49% |
| B03 | review | Rules: fee · SLA working days · levels | M · 1.5 | B01 | 9 | yolo2 (do), cyolo1 (check) | 37.5–55.6 | yolo2 47.9 (U=0.768 F=0.012 R=0.382 V=0.75 L=0.0) · cap 50.86M · 5h 3.9% / week 0.49% · 2nd yolo1 47.4 · cyolo1 20.1 (U=0.128 F=0.002 R=0.693 V=0.525 L=0.333) · cap 40.13M · 5h 1.17% / week 0.15% |
| B04 | yolo | Auth + register + RBAC | M · 1.5 | B01 | 9 | yolo2 (do) | 25.0–37.5 | yolo2 48.5 (U=0.768 F=0.012 R=0.421 V=0.75 L=0.0) · cap 50.86M · 5h 3.9% / week 0.49% · 2nd yolo1 47.4 |
| B05 | yolo | Citizen apply: forms · upload · drafts | L · 3 | B03, B04 | 7.5 | yolo2 (do) | 55.6–80.6 | yolo2 45.1 (U=0.768 F=0.024 R=0.304 V=0.625 L=0.0) · cap 13.31M · 5h 7.8% / week 0.98% · 2nd yolo1 44.5 |
| B06 | yolo | Pay QR · case no · my cases · cancel · resubmit | M · 1.5 | B03, B05 | 4.5 | yolo1 (do) | 80.6–93.1 | yolo1 40.0 (U=0.768 F=0.012 R=0.226 V=0.375 L=0.0) · cap 8.81M · 5h 3.9% / week 0.49% · 2nd yolo2 40.0 |
| B07 | yolo | Officer workflow: queue · claim · return · route · approve | L · 3 | B03, B04 | 7.5 | yolo1 (do) | 55.6–80.6 | yolo1 44.5 (U=0.768 F=0.024 R=0.265 V=0.625 L=0.0) · cap 11.81M · 5h 7.8% / week 0.98% · 2nd yolo2 41.5 |
| B08 | yolo | Digital document · PDF · /verify | M · 1.5 | B07 | 4.5 | yolo2 (do) | 80.6–93.1 | yolo2 40.0 (U=0.768 F=0.012 R=0.226 V=0.375 L=0.0) · cap 8.81M · 5h 3.9% / week 0.49% · 2nd yolo1 36.9 |
| B09 | yolo | Notifications (bell) | M · 1.5 | B03, B07 | 4.5 | yolo1 (do) | 80.6–93.1 | yolo1 36.9 (U=0.768 F=0.012 R=0.187 V=0.375 L=0.25) · cap 5.92M · 5h 3.9% / week 0.49% · 2nd yolo2 36.9 |
| B10 | review | Dashboard KPIs + Excel/PDF export | M · 1.5 | B02, B03 | 4.5 | yolo2 (do), cyolo1 (check) | 55.6–73.7 | yolo2 38.1 (U=0.768 F=0.012 R=0.265 V=0.375 L=0.25) · cap 8.92M · 5h 3.9% / week 0.49% · 2nd yolo1 37.5 · cyolo1 19.3 (U=0.128 F=0.002 R=0.682 V=0.262 L=0.0) · cap 41.05M · 5h 1.17% / week 0.15% |
| B11 | yolo | Audit trail page + admin pages | M · 1.5 | B01 | 4.5 | yolo1 (do) | 37.5–50.0 | yolo1 41.7 (U=0.768 F=0.012 R=0.343 V=0.375 L=0.0) · cap 13.31M · 5h 3.9% / week 0.49% · 2nd yolo2 39.2 |
| B12 | cyolo | Playwright part 1: AUTH→SLA | L · 3 | – | 6 | cyolo1 (do) | 0.0–37.5 | cyolo1 22.9 (U=0.128 F=0.01 R=0.822 V=0.35 L=0.0) · cap 41.05M · 5h 7.8% / week 0.98% |
| B13 | cyolo | Playwright part 2: NOTI→NFR | L · 3 | – | 6 | cyolo1 (do) | 0.0–37.5 | cyolo1 18.4 (U=0.128 F=0.01 R=0.744 V=0.35 L=0.333) · cap 40.13M · 5h 7.8% / week 0.98% |
| B14 | yolo | Integrate + full Playwright + BUG_MODE ×12 | L · 3 | B02, B06, B08, B09, B10, B11, B12, B13 | 3 | yolo2 (do) | 93.1–118.1 | yolo2 37.2 (U=0.768 F=0.025 R=0.148 V=0.25 L=0.0) · cap 7.31M · 5h 7.8% / week 0.98% · 2nd yolo1 36.6 |

Total ≈ **118.1 min** · peak 4 agents at once.
Reason shorthand: U urgency (week reset soon) · F fit · R 5 h room · V speed × critical · L load.
