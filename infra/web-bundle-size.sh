#!/usr/bin/env bash
# web-bundle-size.sh — what a website downloads for the PayCraft browser SDK stays small
# (paycraft-core-split GOAL AC-5 / D4: ≤ 150 KB; paycraft-paywall-analytics D5: per-entry budgets).
#
# Two entries, each held to its own budget:
#   core  cmp-paycraft-web     every page that checks isAdFree() loads it        153600 B (150 KB)
#   ui    cmp-paycraft-web-ui  checkout page + exit survey, imported lazily       20480 B (20 KB)
#         by buyers only (a separate dist with its own trimmed Kotlin stdlib)
# Measured the way a site ships them: every `.mjs` of an entry minified with terser (the one Kotlin's npm
# toolchain already installs), gzipped at level 9, summed. The raw gzip sum (unminified) is printed for
# information only — it measures whitespace and long Kotlin names, not bytes on the wire. An entry with no
# `.mjs` is an error, never a pass.
#
# Usage: bash infra/web-bundle-size.sh                         # build both entries, check both budgets
#        bash infra/web-bundle-size.sh --entry DIR:BYTES ...   # check these dists (repeatable)
#        bash infra/web-bundle-size.sh --dist DIR [--budget-bytes N]   # one dist (default budget 150 KB)
# Exit 0 = every entry within budget · 1 = an entry over budget · 2 = nothing to measure / toolchain / usage.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_BUDGET=153600
UI_BUDGET=20480
ENTRIES=()
DIST=""
BUDGET=$CORE_BUDGET
while [[ $# -gt 0 ]]; do
  case "$1" in
    --entry) ENTRIES+=("${2:-}"); shift 2 ;;
    --dist) DIST="${2:-}"; shift 2 ;;
    --budget-bytes) BUDGET="${2:-}"; shift 2 ;;
    *) echo "usage: $0 [--entry DIR:BYTES]... | [--dist DIR] [--budget-bytes N]" >&2; exit 2 ;;
  esac
done
if [[ -n "$DIST" ]]; then
  ENTRIES+=("$DIST:$BUDGET")
elif (( ${#ENTRIES[@]} == 0 )); then
  (cd "$ROOT" && ./gradlew -q :cmp-paycraft-web:jsBrowserProductionLibraryDistribution \
    :cmp-paycraft-web-ui:jsBrowserProductionLibraryDistribution)
  ENTRIES=("$ROOT/cmp-paycraft-web/build/dist/js/productionLibrary:$CORE_BUDGET"
           "$ROOT/cmp-paycraft-web-ui/build/dist/js/productionLibrary:$UI_BUDGET")
fi
TERSER="${TERSER:-$ROOT/build/js/node_modules/.bin/terser}"
[[ -x "$TERSER" ]] || { echo "FAIL terser not found at $TERSER (run ./gradlew kotlinNpmInstall)"; exit 2; }

shopt -s nullglob
worst=0
for entry in "${ENTRIES[@]}"; do
  dir="${entry%:*}"; budget="${entry##*:}"
  [[ "$budget" =~ ^[0-9]+$ ]] || { echo "FAIL bad budget in --entry $entry (want DIR:BYTES)"; exit 2; }
  files=("$dir"/*.mjs)
  if (( ${#files[@]} == 0 )); then echo "FAIL no .mjs in $dir"; worst=2; continue; fi
  raw=0; min=0
  for f in "${files[@]}"; do
    raw=$((raw + $(gzip -9c "$f" | wc -c)))
    min=$((min + $("$TERSER" "$f" --module --compress --mangle | gzip -9c | wc -c)))
  done
  echo "entry=$dir files=${#files[@]} raw_gzip=${raw}B min_gzip=${min}B budget=${budget}B"
  if (( min <= budget )); then
    echo "PASS"
  else
    echo "FAIL over budget by $((min - budget))B"
    (( worst == 2 )) || worst=1
  fi
done
exit $worst
