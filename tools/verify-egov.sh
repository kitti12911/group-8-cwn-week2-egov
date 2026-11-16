#!/usr/bin/env bash
# Independent check of the egov-eservice build: start the web with docker compose inside `multi-account`,
# run the full Playwright suite, print pass/fail. No AI calls, no tokens.
# Usage: tools/verify-egov.sh [BUG_CODE]     e.g. tools/verify-egov.sh B03   (empty = correct web)
set -uo pipefail
BUG=${1:-}
docker exec -i -e BUG="$BUG" multi-account bash -s <<'IN'
set -uo pipefail
cd /workspace/plans/egov-eservice/app
docker compose down -v >/dev/null 2>&1; docker rm -f egov-nontest >/dev/null 2>&1
rm -f data/egov.db
TEST_MODE=1 BUG_MODE="$BUG" docker compose up -d --build >/tmp/verify-build.log 2>&1 || { tail -20 /tmp/verify-build.log; exit 1; }
docker run -d --rm --name egov-nontest -p 3001:3000 egov-eservice:local >/dev/null      # TC-NFR-03: no TEST_MODE
for _ in $(seq 1 60); do curl -sf http://localhost:3000/api/health >/dev/null && break; sleep 2; done
DB_PATH=$PWD/data/egov.db NON_TEST_BASE_URL=http://localhost:3001 ENCRYPTION_METHOD=AES-256-GCM \
  PW_CHROMIUM_PATH=$(ls -d /opt/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux-*/chrome-headless-shell | head -1) \
  npx playwright test --reporter=list --output=/tmp/verify-results >/tmp/verify-run.log 2>&1
echo "BUG_MODE=${BUG:-none}"
grep -E '^\s+✘|^\s+[0-9]+ (passed|failed|flaky|skipped)' /tmp/verify-run.log | sed 's/^ *//' | cut -c1-110
docker rm -f egov-nontest >/dev/null 2>&1; docker compose down >/dev/null 2>&1
IN
