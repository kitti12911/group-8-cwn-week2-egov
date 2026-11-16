# group-8-cwn-week2-egov

Week 2 lab: a central e-Service web for a fictional city, built by an agent team (Claude + Codex accounts in the
`multi-account` container) from the TA brief `egov-brief`, then proven with Playwright.

| Folder | What |
| --- | --- |
| `week2/egov-eservice/` | plan (`blocks.json` · `dag.png` · `gantt-plan.png` · `PLAN.md`), later `app/`, test report, `BUG-HUNT.md` |

| Step | Result |
| --- | --- |
| Plan | 14 blocks · `dag.png` · `gantt-plan.png` · `PLAN.md` |
| Build | 14/14 blocks ok in 89 min (plan 118) · `REPORT.md` · `gantt-actual.png` · `compare.png` |
| Tests | 51/51 Playwright pass on `docker compose` (checked again by us, not only the agent) · `app/TEST-REPORT.md` |

Run: `cd week2/egov-eservice/app && TEST_MODE=1 docker compose up -d --build` → <http://localhost:3000>
