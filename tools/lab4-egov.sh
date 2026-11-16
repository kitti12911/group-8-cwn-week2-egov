#!/usr/bin/env bash
# Lab 4 (egov): full Playwright run with video → test-report/ (index.html · results.json · gif/<TC>.gif for P1 TCs).
# Web runs with docker compose inside `multi-account`; GIFs are made on the Mac with ffmpeg. No AI calls.
# Usage: tools/lab4-egov.sh <repo>/week2/egov-eservice
set -uo pipefail
DEST=${1:?path to week2/egov-eservice in the repo}
BRIEF="$(cd "$(dirname "$0")/../.." && pwd)/homework-week-2/egov-brief/TEST-PLAN.md"
WORK=$(mktemp -d)

docker exec -i multi-account bash -s <<'IN'
set -uo pipefail
cd /workspace/plans/egov-eservice/app
docker compose down -v >/dev/null 2>&1; docker rm -f egov-nontest >/dev/null 2>&1; rm -f data/egov.db
TEST_MODE=1 docker compose up -d --build >/dev/null 2>&1
docker run -d --rm --name egov-nontest -p 3001:3000 egov-eservice:local >/dev/null
for _ in $(seq 1 60); do curl -sf http://localhost:3000/api/health >/dev/null && break; sleep 2; done
rm -rf /tmp/pw-video /tmp/pw-results.json test-report
DB_PATH=$PWD/data/egov.db NON_TEST_BASE_URL=http://localhost:3001 ENCRYPTION_METHOD=AES-256-GCM \
  PW_CHROMIUM_PATH=$(ls -d /opt/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux-*/chrome-headless-shell | head -1) \
  PW_VIDEO_DIR=/tmp/pw-video npx playwright test -c playwright.report.config.ts >/tmp/lab4-run.log 2>&1
cp /tmp/pw-results.json test-report/results.json
tail -3 /tmp/lab4-run.log
docker rm -f egov-nontest >/dev/null 2>&1; docker compose down >/dev/null 2>&1
IN

docker cp multi-account:/workspace/plans/egov-eservice/app/test-report "$WORK/test-report" >/dev/null
docker cp multi-account:/tmp/pw-video "$WORK/video" >/dev/null
mkdir -p "$WORK/test-report/gif"

# P1 TCs from the summary table of TEST-PLAN.md
P1=$(sed -n '/^## 1\./,/^## 2\./p' "$BRIEF" | awk -F'|' '$4 ~ /P1/ {gsub(/ /,"",$2); print $2}')
made=0; none=()
for tc in $P1; do
  d="$WORK/video/$tc"
  if [ ! -d "$d" ] || [ -z "$(ls "$d"/*.webm 2>/dev/null)" ]; then none+=("$tc"); continue; fi
  list="$WORK/$tc.txt"; : >"$list"
  for f in $(ls -tr "$d"/*.webm); do [ "$(stat -f%z "$f")" -gt 5000 ] && echo "file '$f'" >>"$list"; done
  [ -s "$list" ] || { none+=("$tc"); continue; }
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" \
    -vf "fps=3,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer" \
    "$WORK/test-report/gif/$tc.gif" && made=$((made+1))
done
{ echo "# P1 GIFs"; echo
  echo "$made of $(echo "$P1" | wc -w | tr -d ' ') P1 TCs have a GIF (one GIF = all browser windows of that TC, in order)."
  echo; echo "API-only P1 TCs (no browser window, so no video): ${none[*]:-none}"
  echo; echo "Full results: \`index.html\` (Playwright HTML report) · \`results.json\`."; } >"$WORK/test-report/gif/README.md"

rm -rf "$DEST/test-report"; cp -R "$WORK/test-report" "$DEST/test-report"
echo "GIFs: $made · no video: ${#none[@]} · size $(du -sh "$DEST/test-report" | cut -f1) → $DEST/test-report"
rm -rf "$WORK"
