#!/usr/bin/env bash
# web-ui-api-check.sh — the lazy UI module still fits the SDK it drives (paycraft-paywall-analytics D5).
#
# cmp-paycraft-web-ui does not depend on cmp-paycraft-web (that would re-ship the SDK in its dist); it calls the
# page's PayCraftWeb through the members it declares in PayCraftWebApi.kt. A member renamed or removed in the SDK
# would compile on both sides and fail only in a buyer's browser — so every `fun x(` declared there must be a
# method `x(` in the built paycraft-web.d.mts, and every `val x:` a getter `get x()`.
#
# Usage: bash infra/web-ui-api-check.sh [--api FILE] [--dts FILE]
#   defaults: the UI module's PayCraftWebApi.kt vs cmp-paycraft-web's production library .d.mts
# Exit 0 = every member present · 1 = a member missing (named) · 2 = missing input.
set -euo pipefail
API="cmp-paycraft-web-ui/src/jsMain/kotlin/com/mobilebytelabs/paycraft/web/ui/PayCraftWebApi.kt"
DTS="cmp-paycraft-web/build/dist/js/productionLibrary/paycraft-web.d.mts"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --dts) DTS="$2"; shift 2 ;;
    *) echo "usage: $0 [--api FILE] [--dts FILE]" >&2; exit 2 ;;
  esac
done
[[ -s "$API" && -s "$DTS" ]] || { echo "FAIL missing input ($API | $DTS)"; exit 2; }

missing=()
funs="$(grep -oE '^[[:space:]]+fun [A-Za-z0-9_]+\(' "$API" | sed -E 's/^[[:space:]]+fun //; s/\($//' | sort -u)"
vals="$(grep -oE '^[[:space:]]+val [A-Za-z0-9_]+:' "$API" | sed -E 's/^[[:space:]]+val //; s/:$//' | sort -u)"
[[ -n "$funs$vals" ]] || { echo "FAIL no members declared in $API"; exit 2; }
for f in $funs; do grep -qE "^[[:space:]]+$f\(" "$DTS" || missing+=("fun $f"); done
for v in $vals; do grep -qE "^[[:space:]]+get $v\(\)" "$DTS" || missing+=("val $v"); done

n=$(( $(wc -w <<<"$funs") + $(wc -w <<<"$vals") ))
if (( ${#missing[@]} == 0 )); then
  echo "PASS web UI api ($n members present in $(basename "$DTS"))"
else
  echo "FAIL the web UI calls members the SDK no longer exports:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi
