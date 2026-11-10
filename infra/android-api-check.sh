#!/usr/bin/env bash
# android-api-check.sh — the Android public API survives the core split (paycraft-core-split GOAL AC-4a).
#
# binary-compatibility-validator does not dump the `com.android.kotlin.multiplatform.library` target, so
# api-split-diff.sh cannot see Android-only API (PayCraftInitializer, PayCraftAuthActivity, the Android
# PayCraftPlatform, the Play Billing client). This gate compares PUBLISHED bytecode instead:
#   baseline  = the public signatures of io.github.mobilebytelabs:cmp-paycraft-android:2.5.2 from Maven
#               Central, frozen in infra/api-baseline/2.5.2/android/cmp-paycraft-android.sigs
#   current   = the union of the cmp-paycraft-core and cmp-paycraft release AARs built from this tree
# A signature in the baseline that is missing from the union fails, except GOAL D5 (the BillingBenefit /
# BenefitIcon classes' own members), D11 (the device-limit data classes' constructor/copy) and
# Compose-compiler `$stable` fields. Kotlin `internal` members
# (name-mangled with the module name) are not API and are ignored on both sides.
# It also asserts the merged-manifest essentials moved with the code: the androidx-startup
# PayCraftInitializer entry and PayCraftAuthActivity are declared in the core AAR's manifest.
#
# Usage: bash infra/android-api-check.sh [--record-baseline | --compare <base> <current> <manifest>]
#   --record-baseline  re-derive the frozen baseline from Maven Central (only when the baseline version
#                      changes; never to make a failure go away).
# Exit 0 = nothing removed · 1 = removals or manifest entries missing · 2 = toolchain/input problem.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_SIGS="$ROOT/infra/api-baseline/2.5.2/android/cmp-paycraft-android.sigs"
WORK="$ROOT/build/android-api-check"
command -v javap > /dev/null || { echo "FAIL javap not found (needs a JDK)"; exit 2; }

# One line per public/protected declaration: "<class header>" or "<class header> :: <member>".
sigs() {
  local jar="$1"
  local classes=()
  while IFS= read -r c; do classes+=("$c"); done < <(unzip -Z1 "$jar" | grep '\.class$' | sed 's/\.class$//; s#/#.#g')
  ((${#classes[@]})) || return 0
  printf '%s\n' "${classes[@]}" | xargs -n 200 javap -public -cp "$jar" 2> /dev/null |
    awk '
      /^Compiled from/ { next }
      # A class header at column 0: public/protected ones open a scope, any other (package-private
      # coroutine/lambda classes) closes it so their bodies are not read as the previous class.
      /^[a-z].*(class|interface|enum) .*\{$/ {
        if ($0 ~ /^(public|protected) /) { c = $0; print c } else { c = "" }
        next
      }
      /^}/ { c = ""; next }
      NF && c != "" { print c " :: " $0 }
    ' |
    sed -E 's/[[:space:]]+/ /g; s/ $//' |
    grep -vE '[$](io_github_mobilebytelabs_)?cmp_paycraft(_core)?([^A-Za-z0-9_]|$)|[$]stable;$' |
    sort -u
}

mkdir -p "$WORK"
if [[ "${1:-}" == "--record-baseline" ]]; then
  mkdir -p "$(dirname "$BASE_SIGS")"
  curl -sfL -o "$WORK/base.aar" \
    https://repo1.maven.org/maven2/io/github/mobilebytelabs/cmp-paycraft-android/2.5.2/cmp-paycraft-android-2.5.2.aar ||
    { echo "FAIL could not download the 2.5.2 AAR"; exit 2; }
  (cd "$WORK" && rm -f classes.jar && unzip -qo base.aar classes.jar && mv classes.jar base-classes.jar)
  sigs "$WORK/base-classes.jar" > "$BASE_SIGS"
  echo "recorded $(wc -l < "$BASE_SIGS" | tr -d ' ') signatures → ${BASE_SIGS#"$ROOT/"}"
  exit 0
fi

MANIFEST="$WORK/core/AndroidManifest.xml"
if [[ "${1:-}" == "--compare" ]]; then
  # Test seam for the canary: compare prepared signature files + a manifest, no Gradle build.
  BASE_SIGS="${2:-}"; CURRENT_SIGS="${3:-}"; MANIFEST="${4:-}"
  [[ -s "$BASE_SIGS" && -s "$CURRENT_SIGS" && -s "$MANIFEST" ]] || { echo "usage: $0 --compare <base.sigs> <current.sigs> <AndroidManifest.xml>"; exit 2; }
  cp "$CURRENT_SIGS" "$WORK/current.sigs"
else
[[ -s "$BASE_SIGS" ]] || { echo "FAIL missing baseline $BASE_SIGS (run with --record-baseline)"; exit 2; }
(cd "$ROOT" && ./gradlew -q :cmp-paycraft-core:bundleAndroidMainAar :cmp-paycraft:bundleAndroidMainAar)
CORE_AAR="$ROOT/cmp-paycraft-core/build/outputs/aar/cmp-paycraft-core.aar"
UI_AAR="$ROOT/cmp-paycraft/build/outputs/aar/cmp-paycraft.aar"
for a in "$CORE_AAR" "$UI_AAR"; do [[ -s "$a" ]] || { echo "FAIL missing $a"; exit 2; }; done
rm -rf "$WORK/core" "$WORK/ui" && mkdir -p "$WORK/core" "$WORK/ui"
(cd "$WORK/core" && unzip -qo "$CORE_AAR" classes.jar AndroidManifest.xml)
(cd "$WORK/ui" && unzip -qo "$UI_AAR" classes.jar)
{ sigs "$WORK/core/classes.jar"; sigs "$WORK/ui/classes.jar"; } | sort -u > "$WORK/current.sigs"
fi

bad=0
# Compiler-generated classes are not source API: `$$inlined$` copies of inline lambdas (e.g. Koin's
# `viewModelOf`, whose binding moved to PayCraftUiModule per D5) and Compose's `ComposableSingletons$…`
# lambda holders, which the Compose compiler regenerates whenever a file's lambdas change.
# Compose resources shard generated string accessors over String<N>_commonMainKt; adding strings moves
# them between shards while `Res.string.x` stays the same — the shard number is not API (a really removed
# accessor still reads as removed).
norm() { sed -E 's/String[0-9]+_commonMainKt/StringN_commonMainKt/g' "$1" | sort -u; }
# D11 (one subscription, up to N devices — PayCraft migration 178): these data classes gained defaulted
# fields, which changes ONLY their constructor and copy/copy$default. PlanSectionState is Kotlin `internal`
# (public in bytecode). Any other member of them stays gated.
D11_OWNER='paycraft[.](network[.]RegisterDeviceResult|model[.]BillingState[$](DeviceConflict|OwnershipVerified)|ui[.]PlanSectionState) '
D11_MEMBER=' :: public (static |final )*(com[.]mobilebytelabs[.]paycraft[.][A-Za-z.$]+ )?(com[.]mobilebytelabs[.]paycraft[.][A-Za-z.$]+[(]|copy[(]|copy[$]default[(])'
removed="$(comm -23 <(norm "$BASE_SIGS") <(norm "$WORK/current.sigs") |
  grep -vE 'paycraft[.]model[.](BillingBenefit|BenefitIcon)([^A-Za-z0-9_$]|$)' |
  grep -vE '[$][$]inlined[$]|[.]ComposableSingletons[$]' |
  awk -v o="$D11_OWNER" -v m="$D11_MEMBER" '$0 ~ o && $0 ~ m { next } { print }' || true)"
if [[ -n "$removed" ]]; then
  echo "FAIL — Android public signatures removed outside GOAL D5 / D11 ($(printf '%s\n' "$removed" | wc -l | tr -d ' ')):"
  printf '%s\n' "$removed" | head -40
  bad=1
fi
for needle in 'com.mobilebytelabs.paycraft.PayCraftInitializer' 'androidx.startup.InitializationProvider' 'PayCraftAuthActivity'; do
  grep -q "$needle" "$MANIFEST" || { echo "FAIL core AAR manifest lacks $needle"; bad=1; }
done
[[ $bad -eq 0 ]] && echo "PASS — Android API: $(wc -l < "$BASE_SIGS" | tr -d ' ') baseline signatures all present; startup + auth activity in core manifest"
exit $bad
