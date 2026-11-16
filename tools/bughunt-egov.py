#!/usr/bin/env python3
"""bughunt-egov.py: build BUG-HUNT.md (BUGS.md §4 table + triage) from the Lab 5 Playwright JSON runs.

Usage: python3 tools/bughunt-egov.py <lab5 json dir> <BUGS.md> <out BUG-HUNT.md>
"""
import json
import re
import sys
from pathlib import Path

TC = re.compile(r"TC-[A-Z]+-\d+")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def bug_table(bugs_md):
    """§2 of BUGS.md → {code: (must_fail, may_fail)}"""
    rows, in2 = {}, False
    for line in Path(bugs_md).read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            in2 = line.startswith("## 2.")
        m = re.match(r"\|\s*\*\*(B\d\d)\*\*\s*\|", line)
        if in2 and m:
            cols = [c.strip() for c in line.strip().strip("|").split("|")]
            rows[m.group(1)] = (sorted(set(TC.findall(cols[3]))), sorted(set(TC.findall(cols[4]))))
    return rows


def results(path):
    """Playwright JSON → {tc: (status, first error line)}"""
    out = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            m = TC.match(spec["title"])
            if not m:
                continue
            r = spec["tests"][0]["results"][-1]
            msg = ""
            if r.get("errors"):
                msg = ANSI.sub("", r["errors"][0].get("message", ""))
            lines = [x.strip() for x in msg.splitlines() if x.strip()]
            short = " · ".join(lines[:3])[:220]
            out[m.group(0)] = (r["status"], short)
        for s in suite.get("suites", []):
            walk(s)

    for s in json.loads(Path(path).read_text())["suites"]:
        walk(s)
    return out


def fmt(xs):
    return " · ".join(xs) if xs else "–"


def main(src, bugs_md, dest):
    src = Path(src)
    table = bug_table(bugs_md)
    runs = {p.stem: results(p) for p in sorted(src.glob("*.json"))}
    failed = {k: sorted(t for t, (st, _) in v.items() if st != "passed") for k, v in runs.items()}

    out = ["# BUG-HUNT · egov-eservice", "",
           "Proof that our 51 Playwright tests catch the 12 bugs of `BUGS.md`. Every run = fresh `docker compose up` with",
           "`TEST_MODE=1` (+ `BUG_MODE`), then the full suite. Made by `week-2-lab/tools/lab5-egov.sh` (no AI) and",
           "`bughunt-egov.py`. Raw Playwright JSON per run: `bug-hunt-runs/`.", ""]

    # steps 1, 2, 6 (+ 5 below)
    out += ["## Correct web (BUGS.md §3 steps 1 · 2 · 6)", "", "| Run | When | Passed | Failed |", "| --- | --- | --- | --- |"]
    when = {"normal1": "step 1 · first run", "normal2": "step 2 · again, no restart", "normal3": "step 6 · after all bugs"}
    for k in ("normal1", "normal2", "normal3"):
        if k in runs:
            out.append(f"| {k} | {when[k]} | {len(runs[k]) - len(failed[k])} | {fmt(failed[k])} |")
    out.append("")

    # §4 table
    out += ["## Table (BUGS.md §4)", "",
            "| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |",
            "| --- | --- | --- | --- | --- | --- |"]
    n1 = runs.get("normal1", {})
    out.append(f"| (ปกติ) | – | {fmt(failed.get('normal1', []))} | – | – | {len(n1) - len(failed.get('normal1', []))}/{len(n1)} passed |")
    caught = 0
    verdicts = {}
    for code, (must, may) in sorted(table.items()):
        if code not in runs:
            out.append(f"| {code} | {fmt(must)} | not run | | | |")
            continue
        got = failed[code]
        extra = [t for t in got if t not in must and t not in may]
        missed = [t for t in must if t not in got]
        ok = not missed and not extra
        caught += ok
        verdicts[code] = ok
        exp = fmt(must) + (f" (อาจล้มด้วย {fmt(may)})" if may else "")
        res = f"{'✅' if ok else '❌'} {len(runs[code]) - len(got)} passed · {len(got)} failed"
        out.append(f"| {code} | {exp} | {fmt(got)} | {fmt(extra)} | {fmt(missed)} | {res} |")
    out += ["", f"**Caught: {caught} / {len(table)} bugs** (all must-fail TCs fail, nothing outside the allowed list fails).", ""]

    # step 5 combos
    combos = [k for k in runs if "," in k]
    if combos:
        out += ["## Combined bugs (BUGS.md §3 step 5)", "", "| BUG_MODE | Failed | Union of single runs | Same? |",
                "| --- | --- | --- | --- |"]
        for k in combos:
            union = sorted(set().union(*(failed.get(b, []) for b in k.split(","))))
            out.append(f"| `{k}` | {fmt(failed[k])} | {fmt(union)} | {'✅' if failed[k] == union else '❌'} |")
        out.append("")

    # step 4: why it failed (value diff, not timeout)
    out += ["## Why each TC failed (BUGS.md §3 step 4)", "",
            "First lines of the assert message. A good catch shows expected vs received, not a timeout.", "",
            "| Bug | TC | Message | Kind |", "| --- | --- | --- | --- |"]
    for code in sorted(table):
        for t in failed.get(code, []):
            msg = runs[code][t][1].replace("|", "\\|")
            kind = "timeout ⚠️" if re.search(r"Timeout|timed out|waiting for", msg) else "value"
            out.append(f"| {code} | {t} | {msg} | {kind} |")
    out.append("")
    Path(dest).write_text("\n".join(out), encoding="utf-8")
    print(f"caught {caught}/{len(table)} → {dest}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
