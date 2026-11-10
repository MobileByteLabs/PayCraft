#!/usr/bin/env bash
# Canary for infra/release-coverage-check.sh: red (today's 2.5.2 shape — single hardcoded artifact,
# release assembles :cmp-paycraft only, core not publishable) must fail; green (all four cmp-* modules
# wired, web vendored-only, 3.0.0 above Maven) must pass. Maven is pinned so the canary is offline.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../release-coverage-check.sh"; fail=0
PAYCRAFT_MAVEN_LATEST=2.5.2 bash "$GATE" "$HERE/red" > /dev/null 2>&1; r=$?
PAYCRAFT_MAVEN_LATEST=2.5.2 bash "$GATE" "$HERE/green" > /dev/null 2>&1; g=$?
[[ $r -eq 1 ]] && rs="red: exit 1 (expected)" || { rs="red: exit $r (UNEXPECTED)"; fail=1; }
[[ $g -eq 0 ]] && gs="green: exit 0 (expected)" || { gs="green: exit $g (UNEXPECTED)"; fail=1; PAYCRAFT_MAVEN_LATEST=2.5.2 bash "$GATE" "$HERE/green"; }
echo "$rs · $gs"; exit $fail
