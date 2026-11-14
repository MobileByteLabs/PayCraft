#!/usr/bin/env bash
# web-ui-options-dts-check.sh — the hand-written CheckoutPageOptions declaration still matches the Kotlin one.
#
# Kotlin types mountCheckout's options as `any`, so cmp-paycraft-web-ui/build.gradle.kts appends a hand-written
# `CheckoutPageOptions` to paycraft-web-ui.d.mts. An option added to the Kotlin `external interface` and not to that
# copy works at runtime but fails every TypeScript site's typecheck (2026-11-14: `successUrl`, reelexport checkout).
# So every `val x:` in the Kotlin interface must be a `readonly x?:` in the built .d.mts, and nothing extra.
#
# Usage: bash infra/web-ui-options-dts-check.sh [--kt FILE] [--dts FILE]
#   defaults: CheckoutPage.kt vs cmp-paycraft-web-ui's production library .d.mts
# Exit 0 = same option set · 1 = drift (named) · 2 = missing input.
set -euo pipefail
KT="cmp-paycraft-web-ui/src/jsMain/kotlin/com/mobilebytelabs/paycraft/web/ui/CheckoutPage.kt"
DTS="cmp-paycraft-web-ui/build/dist/js/productionLibrary/paycraft-web-ui.d.mts"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kt) KT="$2"; shift 2 ;;
    --dts) DTS="$2"; shift 2 ;;
    *) echo "usage: $0 [--kt FILE] [--dts FILE]" >&2; exit 2 ;;
  esac
done
[[ -s "$KT" && -s "$DTS" ]] || { echo "FAIL missing input ($KT | $DTS)"; exit 2; }

block() { awk -v start="$2" '$0 ~ start { on=1; next } on && /^[[:space:]]*}/ { exit } on' "$1"; }
kt="$(block "$KT" 'interface CheckoutPageOptions' | grep -oE '^[[:space:]]+val [A-Za-z0-9_]+:' | sed -E 's/^[[:space:]]+val //; s/:$//' | sort -u)"
ts="$(block "$DTS" 'interface CheckoutPageOptions' | grep -oE '^[[:space:]]+readonly [A-Za-z0-9_]+\?:' | sed -E 's/^[[:space:]]+readonly //; s/\?:$//' | sort -u)"
[[ -n "$kt" ]] || { echo "FAIL no options declared in $KT"; exit 2; }

missing="$(comm -23 <(echo "$kt") <(echo "$ts"))"
extra="$(comm -13 <(echo "$kt") <(echo "$ts"))"
if [[ -z "$missing$extra" ]]; then
  echo "PASS CheckoutPageOptions ($(wc -w <<<"$kt" | tr -d ' ') options match $(basename "$DTS"))"
else
  echo "FAIL CheckoutPageOptions in $(basename "$DTS") drifted from the Kotlin interface:"
  for m in $missing; do echo "  missing from .d.mts: $m"; done
  for x in $extra; do echo "  not in Kotlin:       $x"; done
  exit 1
fi
