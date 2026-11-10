#!/usr/bin/env bash
# module-boundary-check.sh — the core/UI split stays split (paycraft-core-split GOAL AC-1, AC-3).
#
#   MB-1  cmp-paycraft/src/commonMain holds only UI: ui/, presentation/, di/PayCraftUiModule.kt,
#         LocalPayCraftConfig.kt, PayCraftBenefits.kt (composeResources + generated Res are not Kotlin
#         sources under kotlin/ and are ignored).
#   MB-2  cmp-paycraft has no platform main source sets left — every platform file is logic and lives in
#         cmp-paycraft-core (androidMain, iosMain, jvmMain, jsMain, wasmJsMain, nativeInterop).
#   MB-3  no Kotlin file in cmp-paycraft-core imports Compose, Koin-Compose or a ViewModel API.
#   MB-4  cmp-paycraft-core/build.gradle.kts declares no Compose / lifecycle / koin-compose dependency.
#
# Usage: bash infra/module-boundary-check.sh [--root <repo-root>]   (default: current directory)
# Exit 0 = boundary holds · 1 = at least one MB-* violation (each printed).
set -uo pipefail

ROOT="."
[[ "${1:-}" == "--root" ]] && ROOT="${2:-.}"
UI="$ROOT/cmp-paycraft/src"
CORE="$ROOT/cmp-paycraft-core"
P="kotlin/com/mobilebytelabs/paycraft"
bad=0

ALLOW='^(ui/|presentation/|di/PayCraftUiModule\.kt$|LocalPayCraftConfig\.kt$|PayCraftBenefits\.kt$)'
while IFS= read -r f; do
  rel="${f#"$UI/commonMain/$P/"}"
  [[ "$rel" =~ $ALLOW ]] || { echo "MB-1 logic left in the UI module: $rel"; bad=1; }
done < <(find "$UI/commonMain/kotlin" -name '*.kt' -not -path '*/build/*' 2>/dev/null)

for s in androidMain iosMain jvmMain jsMain wasmJsMain nativeInterop; do
  if [[ -n "$(find "$UI/$s" -type f 2>/dev/null)" ]]; then
    echo "MB-2 platform source set left in the UI module: cmp-paycraft/src/$s"; bad=1
  fi
done

hits="$(grep -rlE 'import (androidx\.compose|org\.jetbrains\.compose|org\.koin\.compose|androidx\.lifecycle\.viewmodel|org\.koin\.core\.module\.dsl\.viewModel)' "$CORE/src" 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  while IFS= read -r f; do echo "MB-3 Compose/ViewModel import in core: ${f#"$ROOT/"}"; done <<<"$hits"
  bad=1
fi

# Comment lines are not dependencies; a trailing `// …` on a code line is stripped before matching.
deps="$(grep -nvE '^[[:space:]]*//' "$CORE/build.gradle.kts" 2>/dev/null | sed -E 's#[[:space:]]//.*$##' \
  | grep -iE '(compose|lifecycle|koin\.compose|koin-compose)' || true)"
if [[ -n "$deps" ]]; then
  while IFS= read -r l; do echo "MB-4 Compose/lifecycle in core build: $l"; done <<<"$deps"
  bad=1
fi

[[ $bad -eq 0 ]] && echo "PASS — module boundary holds (UI-only cmp-paycraft, Compose-free cmp-paycraft-core)"
exit $bad
