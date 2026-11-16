#!/usr/bin/env bash
# Print one line each time a block of an agent-team run changes status; exit when nothing is queued or running.
# Usage: tools/watch-run.sh <run-id>   (reads week-2-lab/workspace/.agent-team/<run-id>/state.json)
set -uo pipefail
RUN=${1:?run id}
STATE="$(cd "$(dirname "$0")/.." && pwd)/workspace/.agent-team/$RUN/state.json"
exec python3 -u - "$STATE" <<'PY'
import json, sys, time
path, seen = sys.argv[1], {}
while True:
    try:
        d = json.load(open(path))
    except Exception:
        time.sleep(5); continue
    nodes = d.get("nodes", {})
    for nid, n in sorted(nodes.items()):
        st = n.get("status")
        if seen.get(nid) != st:
            seen[nid] = st
            if st not in ("queued",):
                acc = ",".join(f"{k}={v}" for k, v in (n.get("accounts") or {}).items())
                err = f" · {str(n.get('error'))[:120]}" if n.get("error") else ""
                print(f"{time.strftime('%H:%M')} {nid} {st} {acc}{err}", flush=True)
    left = [k for k, n in nodes.items() if n.get("status") in ("queued", "running", "waiting")]
    if nodes and not left:
        done = sum(n.get("status") == "ok" for n in nodes.values())
        print(f"{time.strftime('%H:%M')} RUN FINISHED · ok {done}/{len(nodes)} · stopped={d.get('stopped')}", flush=True)
        break
    time.sleep(15)
PY
