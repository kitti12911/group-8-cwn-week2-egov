#!/usr/bin/env bash
# Lab 5 (egov): BUGS.md §3 proof. 16 full Playwright runs in `multi-account` (no AI calls):
#   normal1, normal2 (same web, no restart) · B01..B12 one at a time · B03,B07 · B01,B05,B09 · normal3 (all bugs off)
# Each run → JSON in week-2-lab/workspace/lab5/<label>.json, then tools/bughunt-egov.py writes BUG-HUNT.md.
# Usage: tools/lab5-egov.sh
set -uo pipefail
docker exec -i multi-account bash -s <<'IN'
set -uo pipefail
cd /workspace/plans/egov-eservice/app
if pgrep -f "playwright test" >/dev/null; then echo "Error: another playwright run is active, stop it first"; exit 1; fi
OUT=/workspace/lab5; rm -rf "$OUT"; mkdir -p "$OUT"
CHROME=$(ls -d /opt/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux-*/chrome-headless-shell | head -1)
start() {   # $1 = BUG_MODE
  docker compose down -v >/dev/null 2>&1; docker rm -f egov-nontest >/dev/null 2>&1; rm -f data/egov.db
  TEST_MODE=1 BUG_MODE="$1" docker compose up -d --build >/dev/null 2>&1
  docker run -d --rm --name egov-nontest -p 3001:3000 egov-eservice:local >/dev/null
  for _ in $(seq 1 60); do curl -sf http://localhost:3000/api/health >/dev/null && break; sleep 2; done
}
run() {     # $1 = label
  DB_PATH=$PWD/data/egov.db NON_TEST_BASE_URL=http://localhost:3001 ENCRYPTION_METHOD=AES-256-GCM \
    PW_CHROMIUM_PATH=$CHROME PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/$1.json" npx playwright test --reporter=json >/dev/null 2>&1
  python3 -c "import json,sys;s=json.load(open(sys.argv[1]))['stats'];print(sys.argv[2],'passed',s['expected'],'failed',s['unexpected'],flush=True)" "$OUT/$1.json" "$1"
}
start "";  run normal1; run normal2
for b in B01 B02 B03 B04 B05 B06 B07 B08 B09 B10 B11 B12 "B03,B07" "B01,B05,B09"; do start "$b"; run "$b"; done
start "";  run normal3
docker rm -f egov-nontest >/dev/null 2>&1; docker compose down >/dev/null 2>&1
echo LAB5 DONE
IN
