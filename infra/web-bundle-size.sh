#!/usr/bin/env bash
# web-bundle-size.sh — what a website downloads for the PayCraft browser SDK stays small
# (paycraft-core-split GOAL AC-5 / D4: ≤ 150 KB).
#
# Measures the cmp-paycraft-web production library the way a site ships it: every `.mjs` minified with
# terser (the one Kotlin's npm toolchain already installs), gzipped at level 9, summed. The raw gzip sum
# (unminified) is printed for information only — it measures whitespace and long Kotlin names, not bytes
# on the wire. A dist with no `.mjs` is an error, never a pass.
#
# Usage: bash infra/web-bundle-size.sh [--dist <dir>] [--budget-bytes <n>]
#   default: builds :cmp-paycraft-web:jsBrowserProductionLibraryDistribution, budget 153600 B (150 KB)
# Exit 0 = within budget · 1 = over budget · 2 = nothing to measure / toolchain missing / usage.
set -euo pipefail

DIST="cmp-paycraft-web/build/dist/js/productionLibrary"
BUDGET=153600
BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist) DIST="${2:-}"; BUILD=0; shift 2 ;;
    --budget-bytes) BUDGET="${2:-}"; shift 2 ;;
    *) echo "usage: $0 [--dist DIR] [--budget-bytes N]" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $BUILD == 1 ]]; then
  (cd "$ROOT" && ./gradlew -q :cmp-paycraft-web:jsBrowserProductionLibraryDistribution)
  DIST="$ROOT/$DIST"
fi
TERSER="${TERSER:-$ROOT/build/js/node_modules/.bin/terser}"

shopt -s nullglob
files=("$DIST"/*.mjs)
(( ${#files[@]} )) || { echo "FAIL no .mjs in $DIST"; exit 2; }
[[ -x "$TERSER" ]] || { echo "FAIL terser not found at $TERSER (run ./gradlew kotlinNpmInstall)"; exit 2; }

raw=0
min=0
for f in "${files[@]}"; do
  raw=$((raw + $(gzip -9c "$f" | wc -c)))
  min=$((min + $("$TERSER" "$f" --module --compress --mangle | gzip -9c | wc -c)))
done
echo "files=${#files[@]} raw_gzip=${raw}B min_gzip=${min}B budget=${BUDGET}B"
if (( min <= BUDGET )); then
  echo "PASS"
else
  echo "FAIL over budget by $((min - BUDGET))B"
  exit 1
fi
