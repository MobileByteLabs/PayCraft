#!/usr/bin/env bash
# =============================================================================
# deploy-cloud-local.sh — the INLINE twin of .github/workflows/deploy-cloud.yml
# =============================================================================
# Runs the Supabase half of the cloud deploy from this machine, so the loop is
#
#     edit → commit → deploy → verify end-to-end
#
# instead of: push a branch to upstream → workflow_dispatch → wait → read logs.
# That detour exists only because the session branch lives on the FORK while the
# secrets live on UPSTREAM, and it costs ~3 minutes per iteration when the thing
# being verified is a one-line config change.
#
# ── WHAT IT DOES (same order as the workflow, for the same reason) ───────────
#   1. migrations  — `supabase db push` (idempotent; applies only what
#                    supabase_migrations.schema_migrations lacks)
#   2. functions   — `supabase functions deploy` per directory
#   3. smoke       — probes each function and asserts the GATEWAY let it through
#
# Migrations run BEFORE functions so new code never lands against an un-migrated
# schema — the workflow's `needs: [deploy-migrations]` encodes the same rule.
#
# ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
# The Next.js dashboard (Cloudflare Pages) is NOT deployed here. It needs
# wrangler + CLOUDFLARE_* tokens and has its own Node-22 constraint; that half
# stays in CI. This script covers migrations + edge functions, which is the
# surface an SDK/paywall change actually touches.
#
# ── DRIFT ────────────────────────────────────────────────────────────────────
# The two things that have actually gone wrong here are derived, never retyped:
#   * the function list   → the supabase/functions/*/ directory glob (a hardcoded
#                           list is what silently skipped functions before)
#   * public vs private   → supabase/config.toml `verify_jwt = false` blocks
# A second hand-kept copy of either is what lets CI and local disagree.
#
# Usage:
#   bash scripts/deploy-cloud-local.sh              # migrations + functions + smoke
#   bash scripts/deploy-cloud-local.sh --smoke-only # verify only, deploy nothing
#   bash scripts/deploy-cloud-local.sh --dry-run    # show what would run
#
# THIS DEPLOYS TO PRODUCTION. There is no staging project.
# =============================================================================
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
REPO_ROOT="$(pwd)"
# FIVE levels up, not four: workspaces/mbs/PayCraft/source/PayCraft → framework root.
# Four lands on workspaces/ and every vault lookup then fails with a misleading
# "could not resolve from the vault" rather than "wrong path".
FW_ROOT="${FW_ROOT:-$(cd "$REPO_ROOT/../../../../.." 2>/dev/null && pwd)}"
[ -f "$FW_ROOT/core/scripts/secrets-get.sh" ] || {
  echo "❌ framework root not found at $FW_ROOT (expected core/scripts/secrets-get.sh)"; exit 1; }

MODE=deploy
case "${1:-}" in
  --smoke-only) MODE=smoke ;;
  --dry-run)    MODE=dry ;;
  "")           MODE=deploy ;;
  *) echo "usage: $0 [--smoke-only|--dry-run]" >&2; exit 2 ;;
esac

REF="$(tr -d '[:space:]' < supabase/.temp/project-ref 2>/dev/null)"
[ -n "$REF" ] || { echo "❌ supabase/.temp/project-ref is empty"; exit 1; }

command -v supabase >/dev/null 2>&1 || { echo "❌ supabase CLI not installed"; exit 1; }
LOCAL_CLI="$(supabase --version 2>/dev/null)"
CI_CLI="$(grep -A2 'setup-cli' .github/workflows/deploy-cloud.yml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
echo "── PayCraft cloud deploy (local) ───────────────────────────────────────"
echo "   project ref : $REF"
echo "   supabase CLI: $LOCAL_CLI local / ${CI_CLI:-?} pinned in CI"
[ "$LOCAL_CLI" != "$CI_CLI" ] && echo "   ⚠ CLI version differs from CI — deploy semantics could differ"
echo "   mode        : $MODE"
echo ""

# ── credential ───────────────────────────────────────────────────────────────
# Never echoed, never interpolated into a command line. Written 0600 and shredded
# on every exit path (RULE-SECRETS-NO-VALUE-EGRESS-001).
TOKEN_FILE=""
cleanup() { [ -n "$TOKEN_FILE" ] && rm -f "$TOKEN_FILE"; }
trap cleanup EXIT INT TERM

# Only a real deploy needs the credential. --dry-run and --smoke-only must work
# with a cold vault, otherwise "show me what this would do" needs Touch ID.
if [ "$MODE" = deploy ]; then
  TOKEN_FILE="$(mktemp)"; chmod 600 "$TOKEN_FILE"
  if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" framework-supabase-access-token \
         --to-file "$TOKEN_FILE" >/dev/null 2>&1; then
    echo "❌ could not resolve framework-supabase-access-token from the vault"
    echo "   run /secrets pull, or check vault auth with secrets-auth-warm.sh"
    exit 1
  fi
  SUPABASE_ACCESS_TOKEN="$(cat "$TOKEN_FILE")"; export SUPABASE_ACCESS_TOKEN
  echo "✓ access token resolved from vault"
fi

fail=0

# ── 1. migrations ────────────────────────────────────────────────────────────
if [ "$MODE" = deploy ]; then
  echo ""
  echo "── 1/3  migrations ──"
  supabase link --project-ref "$REF" >/dev/null 2>&1 || { echo "❌ supabase link failed"; exit 1; }
  if supabase db push; then echo "✓ migrations applied"; else echo "❌ db push failed"; exit 1; fi
elif [ "$MODE" = dry ]; then
  echo "── 1/3  migrations (dry) ──"
  echo "   would run: supabase link --project-ref $REF && supabase db push"
fi

# ── 2. functions ─────────────────────────────────────────────────────────────
if [ "$MODE" = deploy ] || [ "$MODE" = dry ]; then
  echo ""
  echo "── 2/3  edge functions ──"
  deployed=0
  for d in supabase/functions/*/; do
    name="$(basename "$d")"
    [ -f "${d}index.ts" ] || { echo "   ↷ ${name}: no index.ts — not a function"; continue; }
    if [ "$MODE" = dry ]; then echo "   would deploy: $name"; deployed=$((deployed+1)); continue; fi
    if supabase functions deploy "$name" --project-ref "$REF" >/dev/null 2>&1; then
      echo "   ✓ $name"; deployed=$((deployed+1))
    else
      echo "   ❌ $name failed to deploy"; fail=1
    fi
  done
  echo "   ${deployed} function(s)"
  [ "$deployed" -eq 0 ] && { echo "❌ no functions matched — glob is wrong"; exit 1; }
fi

# ── 3. smoke ─────────────────────────────────────────────────────────────────
# Asserts the question that matters: did the request REACH the function, or did
# the GATEWAY refuse it first? A status code cannot answer that — methods differ
# (GET vs POST → 405 is healthy) and 401 is ambiguous, since after a correct fix
# `config` answers 401 {"error":"invalid_apiKey"} ITSELF. The gateway's refusal
# carries a machine-readable "code":"UNAUTHORIZED_*" envelope; a function's own
# rejection never does. So key on the BODY.
echo ""
echo "── 3/3  smoke ──"
PUBLIC="$(grep -B1 'verify_jwt = false' supabase/config.toml \
          | grep -oE '\[functions\.[a-z-]+\]' | sed 's/\[functions\.//;s/\]//' | tr '\n' ' ')"
for fn in config checkout-initiate coupon-validate register-play-purchase register-appstore account-token billing; do
  [ -d "supabase/functions/$fn" ] || continue
  URL="https://${REF}.supabase.co/functions/v1/${fn}"
  BODY="$(curl -s --max-time 20 "$URL" || true)"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL")"
  case " $PUBLIC " in *" $fn "*) KIND=public ;; *) KIND=private ;; esac
  case "$BODY" in
    *UNAUTHORIZED_NO_AUTH_HEADER*|*UNAUTHORIZED_INVALID_JWT_FORMAT*) GATED=yes ;;
    *) GATED=no ;;
  esac
  case "$CODE" in
    000) echo "   ❌ ${fn}: unreachable (000)"; fail=1; continue ;;
    404) echo "   ❌ ${fn}: 404 — not deployed under that name"; fail=1; continue ;;
  esac
  if [ "$KIND" = public ] && [ "$GATED" = yes ]; then
    echo "   ❌ ${fn}: gateway rejected BEFORE the function ran (${CODE}) though config.toml says verify_jwt=false"
    echo "      → this is the 'You appear to be offline' outage"
    fail=1
  elif [ "$KIND" = private ] && [ "$GATED" = no ]; then
    echo "   ❌ ${fn}: reached the function anonymously (${CODE}) but is NOT declared verify_jwt=false"
    fail=1
  elif [ "$KIND" = public ]; then
    echo "   ✓ ${fn}: ${CODE} (public, reached its own guard)"
  else
    echo "   ✓ ${fn}: ${CODE} (private, gateway JWT enforced)"
  fi
done

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✅ deploy-cloud-local: PASS"
else
  echo "❌ deploy-cloud-local: FAIL"
fi
exit $fail
