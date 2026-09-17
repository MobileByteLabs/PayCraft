#!/usr/bin/env bash
# Commercial-model canary suite (sub-plan 02: AC-6..11, AC-29, AC-30).
#
# Exit 0 only if every case passes. A case that SKIPs (exit 2) because its dependency is not
# running is reported as SKIP and does NOT count as a pass — an unrun canary must never read as
# green, which is the failure mode the whole epic keeps finding.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0; skip=0
for f in "$HERE"/green/*/run.sh "$HERE"/red/*/run.sh; do
    [ -f "$f" ] || continue
    name="${f#$HERE/}"; name="${name%/run.sh}"
    out="$(bash "$f" 2>&1)"; rc=$?
    case "$rc" in
        0) echo "  PASS  $name"; pass=$((pass+1)) ;;
        2) echo "  SKIP  $name"; printf '        %s\n' "$(printf '%s' "$out" | head -1)"; skip=$((skip+1)) ;;
        *) echo "  FAIL  $name"; printf '%s\n' "$out" | sed 's/^/        /'; fail=$((fail+1)) ;;
    esac
done
echo "── $pass passed, $fail failed, $skip skipped ──"
[ "$fail" -eq 0 ] || exit 1
