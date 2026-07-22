#!/usr/bin/env bash
# paycraft-device-verify.sh — E6 ship-gate runner (sub-plan 06, AC8, D14).
#
# Runs the 8 (provider x platform) device-truth maestro flows and records honest per-flow
# evidence per RULE-IMPL-BEHAVIOR-EXECUTED-001:
#   * Android  — build + install the sample-app, assert device-APK md5 == built-APK md5, then run
#                each `maestro test` against the connected device. Each flow's own `stopApp` is the
#                sanctioned fresh-capture force-stop (this OnePlus/ColorOS device denies `pm clear`).
#                A green maestro exit => verdict `maestro-executed` (device-verified).
#   * iOS      — requires a BOOTED simulator (or device) AND an installed iOS sample-app build. When
#                none is present the verdict is `pending-device-verify` (NON-pass) — never faked green.
#
# Evidence is written to build/paycraft-device-verify/ (a build artifact — NOT idea-layer, per
# RULE-CI-001). The canonical BEHAVIOR_VERDICTS.yaml verdict roll-up is authored by Claude with the
# Write tool, not mutated here.
#
# Exit codes:  0 = every attempted flow passed AND none pending  |  1 = a flow FAILED  |  2 = PARTIAL
#              (some flows pending-device-verify — the honest outcome when iOS is unavailable).
#
# Usage: bash scripts/paycraft-device-verify.sh [--android-only] [--skip-build]
set -uo pipefail

APP_ID="com.mobilebytelabs.paycraft.sample"
PROVIDERS=(storekit play stripe razorpay)
ANDROID_ONLY=0
IOS_ONLY=0
SKIP_BUILD=0
for a in "$@"; do
  case "$a" in
    --android-only) ANDROID_ONLY=1 ;;
    --ios-only) IOS_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EVID_DIR="build/paycraft-device-verify"
mkdir -p "$EVID_DIR"
VERDICTS="$EVID_DIR/verdicts.jsonl"
: > "$VERDICTS"

md5_of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | awk '{print $1}'; }
log()    { printf '%s\n' "$*"; }

# Run one maestro flow with resilience to the flaky maestro<->adb session-init failure
# (getCachedDeviceInfo / "tcp … closed") that can abort a run BEFORE any step executes when flows
# fire back-to-back. Ensures the device is responsive, then retries up to 3x, treating a run that
# executed ZERO steps (no "COMPLETED" line) as a retryable init flake — NOT a flow failure.
run_flow_resilient() {
  local flow="$1" out="$2" dev="${3:-}" attempt rc
  for attempt in 1 2 3; do
    adb wait-for-device >/dev/null 2>&1
    adb shell true >/dev/null 2>&1 || { adb kill-server >/dev/null 2>&1; adb start-server >/dev/null 2>&1; }
    sleep 3
    if [ -n "$dev" ]; then maestro --device "$dev" test "$flow" >"$out" 2>&1; else maestro test "$flow" >"$out" 2>&1; fi
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    if grep -q "COMPLETED" "$out"; then return "$rc"; fi   # steps ran -> genuine failure, do not retry
    log "  (retry $attempt/3: maestro session-init flake, no steps executed)"
    adb kill-server >/dev/null 2>&1; adb start-server >/dev/null 2>&1; sleep 4
  done
  return "$rc"
}

FAILED=0
PENDING=0
PASSED=0

# ── Android: build, install, md5-match, run the 4 flows ──────────────────────
if [ "$IOS_ONLY" -eq 1 ]; then
  log "== --ios-only: skipping Android device-verify =="
else
adb devices | grep -qw "device" || { log "FATAL: no Android device connected (adb devices)"; exit 1; }

if [ "$SKIP_BUILD" -eq 0 ]; then
  log ">> ./gradlew :sample-app:installDebug"
  ./gradlew :sample-app:installDebug >"$EVID_DIR/install.log" 2>&1 || {
    log "FATAL: sample-app build/install failed — see $EVID_DIR/install.log"; exit 1; }
fi

BUILT_APK="$(find sample-app/build/outputs/apk/debug -name '*.apk' 2>/dev/null | head -1)"
BUILT_MD5="$(md5_of "$BUILT_APK")"
DEV_PATH="$(adb shell pm path "$APP_ID" | sed 's/package://' | tr -d '\r' | head -1)"
adb pull "$DEV_PATH" "$EVID_DIR/device_base.apk" >/dev/null 2>&1
DEV_MD5="$(md5_of "$EVID_DIR/device_base.apk")"
log "built-APK md5 : $BUILT_MD5"
log "device-APK md5: $DEV_MD5"
if [ -z "$BUILT_MD5" ] || [ "$BUILT_MD5" != "$DEV_MD5" ]; then
  log "FATAL: device-APK md5 != built-APK md5 — RULE-IMPL-BEHAVIOR-EXECUTED-001 md5-match failed"
  exit 1
fi
log "md5-match OK — flows run against the exact built APK"

for p in "${PROVIDERS[@]}"; do
  flow="maestro/paycraft_${p}_android_flow.yaml"
  [ -f "$flow" ] || { log "MISSING $flow"; exit 1; }
  log ">> maestro test $flow"
  if run_flow_resilient "$flow" "$EVID_DIR/${p}_android.log"; then
    log "  PASS  $p/android -> maestro-executed"
    echo "{\"provider\":\"$p\",\"platform\":\"android\",\"verdict\":\"maestro-executed\",\"apk_md5\":\"$DEV_MD5\"}" >>"$VERDICTS"
    PASSED=$((PASSED+1))
  else
    log "  FAIL  $p/android -> see $EVID_DIR/${p}_android.log"
    echo "{\"provider\":\"$p\",\"platform\":\"android\",\"verdict\":\"failed\"}" >>"$VERDICTS"
    FAILED=$((FAILED+1))
  fi
done
fi   # end IOS_ONLY guard for the Android section

# ── iOS: BOOT sim + build the framework/app, install, md5-match, run the 4 flows ─────────────
# The iOS sample-app wrapper lives at sample-app/iosApp/ (xcodegen SwiftUI host embedding the
# Kotlin/Native static SampleApp.framework). When a sim is booted we build + install + md5-match it,
# exactly mirroring the Android path; when none is booted the verdict is pending-device-verify.
if [ "$ANDROID_ONLY" -eq 0 ]; then
  BOOTED="$(xcrun simctl list devices booted 2>/dev/null | grep -c 'Booted' || true)"
  IOS_UDID="$(xcrun simctl list devices booted 2>/dev/null | grep -Eo '[0-9A-Fa-f-]{36}' | head -1)"
  IOS_APP_DIR="sample-app/iosApp"
  IOS_APP="$IOS_APP_DIR/DerivedData/Build/Products/Debug-iphonesimulator/PayCraftSample.app"
  if [ "${BOOTED:-0}" -ge 1 ] && [ "$SKIP_BUILD" -eq 0 ]; then
    log ">> building iOS sample-app (framework + compose resources + xcodegen + xcodebuild)"
    ./gradlew :sample-app:linkDebugFrameworkIosSimulatorArm64 \
              :sample-app:assembleIosSimulatorArm64MainResources \
              :cmp-paycraft:assembleIosSimulatorArm64MainResources >"$EVID_DIR/ios_gradle.log" 2>&1 || {
      log "FATAL: iOS framework/resource build failed — see $EVID_DIR/ios_gradle.log"; exit 1; }
    ( cd "$IOS_APP_DIR" && xcodegen generate ) >"$EVID_DIR/ios_xcodegen.log" 2>&1 || {
      log "FATAL: xcodegen generate failed — see $EVID_DIR/ios_xcodegen.log"; exit 1; }
    xcodebuild -project "$IOS_APP_DIR/PayCraftSample.xcodeproj" -scheme PayCraftSample \
      -sdk iphonesimulator -configuration Debug \
      -destination "platform=iOS Simulator,id=$IOS_UDID" \
      -derivedDataPath "$IOS_APP_DIR/DerivedData" build >"$EVID_DIR/ios_xcodebuild.log" 2>&1 || {
      log "FATAL: xcodebuild failed — see $EVID_DIR/ios_xcodebuild.log"; exit 1; }
  fi
  if [ "${BOOTED:-0}" -ge 1 ]; then
    xcrun simctl install "$IOS_UDID" "$IOS_APP" >"$EVID_DIR/ios_install.log" 2>&1 || {
      log "FATAL: simctl install failed — see $EVID_DIR/ios_install.log"; exit 1; }
    IOS_BUILT_MD5="$(md5_of "$IOS_APP/PayCraftSample")"
    IOS_DEV_MD5="$(md5_of "$(xcrun simctl get_app_container "$IOS_UDID" "$APP_ID" app 2>/dev/null)/PayCraftSample")"
    log "iOS built-app md5 : $IOS_BUILT_MD5"
    log "iOS device-app md5: $IOS_DEV_MD5"
    if [ -z "$IOS_BUILT_MD5" ] || [ "$IOS_BUILT_MD5" != "$IOS_DEV_MD5" ]; then
      log "FATAL: iOS device-app md5 != built-app md5 — RULE-IMPL-BEHAVIOR-EXECUTED-001 md5-match failed"; exit 1; fi
    log "iOS md5-match OK — flows run against the exact built .app"
  fi
  for p in "${PROVIDERS[@]}"; do
    flow="maestro/paycraft_${p}_ios_flow.yaml"
    [ -f "$flow" ] || { log "MISSING $flow"; exit 1; }
    if [ "${BOOTED:-0}" -ge 1 ]; then
      log ">> maestro --device $IOS_UDID test $flow (booted iOS sim)"
      if run_flow_resilient "$flow" "$EVID_DIR/${p}_ios.log" "$IOS_UDID"; then
        log "  PASS  $p/ios -> maestro-executed"
        echo "{\"provider\":\"$p\",\"platform\":\"ios\",\"verdict\":\"maestro-executed\",\"app_md5\":\"${IOS_DEV_MD5:-}\"}" >>"$VERDICTS"
        PASSED=$((PASSED+1))
      else
        log "  FAIL  $p/ios -> see $EVID_DIR/${p}_ios.log"
        echo "{\"provider\":\"$p\",\"platform\":\"ios\",\"verdict\":\"failed\"}" >>"$VERDICTS"
        FAILED=$((FAILED+1))
      fi
    else
      log "  PENDING  $p/ios -> pending-device-verify (no booted iOS simulator + no iOS app build)"
      echo "{\"provider\":\"$p\",\"platform\":\"ios\",\"verdict\":\"pending-device-verify\",\"reason\":\"no-booted-ios-sim\"}" >>"$VERDICTS"
      PENDING=$((PENDING+1))
    fi
  done
fi

log ""
log "==== SUMMARY ====  passed=$PASSED failed=$FAILED pending=$PENDING  (evidence: $VERDICTS)"
if [ "$FAILED" -gt 0 ]; then exit 1; fi
if [ "$PENDING" -gt 0 ]; then
  log "PARTIAL: Android device-verified; iOS pending-device-verify. G-6 is NOT fully green."
  exit 2
fi
log "ALL $PASSED attempted (provider x platform) flows device-verified, 0 pending — G-6 green (full matrix = 8 = 4 providers x android+ios)."
exit 0
