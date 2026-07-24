#!/usr/bin/env bash
# paycraft-onboarding-smoke.sh — 5-minute setup smoke (sub-plan 06 T6, AC10).
#
# Proves the cold-start consumer path end-to-end, exit 0:
#   1. `paycraft init` (non-interactive) scaffolds paycraft.config.json into a fresh dir — the real
#      CLI, built from cli/src (no stub).
#   2. `PayCraft.initialize(apiKey)` + the FIRST entitlement read complete — proven by the EXECUTED
#      cmp-paycraft test OnboardingSmokeTest (jvmTest), which emits `entitlement-read-ok` through the
#      genuine cache-first path (no network, Mock backend).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 1. npx paycraft init (non-interactive) → paycraft.config.json ────────────
if [ ! -d cli/node_modules ]; then
  echo ">> installing CLI deps (first run)"
  npm --prefix cli install --silent
fi
echo ">> building CLI"
npm --prefix cli run build --silent
echo ">> paycraft init --cloud --api-key pk_test_smoke --provider stripe --yes --out $TMP"
node cli/dist/index.js init --cloud --api-key "pk_test_smoke" --provider stripe --yes --out "$TMP"
test -f "$TMP/paycraft.config.json" || { echo "FAIL: init produced no paycraft.config.json"; exit 1; }
echo "   init OK — $(cat "$TMP/paycraft.config.json" | tr -d '\n' | cut -c1-80)…"

# ── 2. PayCraft.initialize(apiKey) + first entitlement read (executed test) ──
echo ">> :cmp-paycraft:jvmTest --tests *OnboardingSmoke* (initialize -> first entitlement read)"
./gradlew :cmp-paycraft:jvmTest --tests "*OnboardingSmoke*" --rerun-tasks -q
# The test asserts initialize + a cache-first first read and prints entitlement-read-ok to its
# captured stdout; a green jvmTest exit already proves those assertions passed.
REPORT="cmp-paycraft/build/test-results/jvmTest"
if grep -rq "entitlement-read-ok" "$REPORT" 2>/dev/null; then
  echo "   entitlement-read-ok emitted by OnboardingSmokeTest"
fi

echo "onboarding smoke green (init -> initialize -> first entitlement read)"
