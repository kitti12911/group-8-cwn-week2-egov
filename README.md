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
| Tests (lab 4) | 51/51 Playwright pass on `docker compose` (checked by us, not only the agent) · `test-report/` (HTML, JSON, GIFs of P1 TCs) |
| Bug hunt (lab 5) | 12/12 `BUG_MODE` bugs caught · combos = union · `BUG-HUNT.md` · raw runs in `bug-hunt-runs/` |
| Scripts | `tools/` (run inside the `multi-account` container, no AI calls) |

Run: `cd week2/egov-eservice/app && TEST_MODE=1 docker compose up -d --build` → <http://localhost:3000>
