#!/usr/bin/env bash
#
# sync-to-vercel.sh — pull PayCraft secrets from framework vault and push to Vercel env.
#
# RULE-SECRETS-VAULT-001 compliant:
# - Never writes secret values to disk except as ephemeral tmpfiles (mode 0600, deleted on exit)
# - Never echoes values to stdout (uses Vercel CLI's stdin input)
# - Uses secrets-get.sh --to-file (SV32) to avoid CLAUDECODE=1 stdout sink
#
# Prereqs:
#   1. All 13 PayCraft secrets pushed to vault (see secrets-push-checklist.md)
#   2. Vercel CLI installed:  npm i -g vercel
#   3. Vercel logged in:       vercel login
#   4. Vercel project linked:  cd dashboard && vercel link
#
# Usage:
#   bash infra/sync-to-vercel.sh                          # dry-run (default)
#   bash infra/sync-to-vercel.sh --apply                  # actually push
#   bash infra/sync-to-vercel.sh --apply --env production # only production env
#   bash infra/sync-to-vercel.sh --apply --env preview    # preview env (PR deploys)
#
set -euo pipefail

# Resolve framework root by walking up until the marker is found.
# The previous fixed-depth (../*7) walk overshot when run from the
# PayCraft.git checkout at workspaces/mbs/PayCraft/source/PayCraft.
FW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [[ "$FW_ROOT" != "/" && ! -f "$FW_ROOT/core/scripts/secrets-get.sh" ]]; do
    FW_ROOT="$(dirname "$FW_ROOT")"
done
[[ -f "${FW_ROOT}/core/scripts/secrets-get.sh" ]] || {
    echo "ERROR: framework root not found from $(dirname "${BASH_SOURCE[0]}") (no core/scripts/secrets-get.sh marker)" >&2
    exit 1
}

# Parse args
APPLY=false
ENV_TARGET="production"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)        APPLY=true; shift ;;
        --env)          ENV_TARGET="$2"; shift 2 ;;
        --dry-run)      APPLY=false; shift ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

# Dashboard runtime + Edge Function-bound secrets that Vercel needs.
# Format: ALIAS:VERCEL_ENV_NAME  (env name matches the alias's env_var unless overridden)
SECRETS=(
    # ─── Stripe platform (PayCraft's own Stripe Connect application) ───
    "mbs-paycraft-stripe-platform-secret-key:STRIPE_SECRET_KEY"
    "mbs-paycraft-stripe-platform-publishable-key:NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
    "mbs-paycraft-stripe-platform-webhook-secret:STRIPE_WEBHOOK_SECRET"
    "mbs-paycraft-stripe-connect-client-id:STRIPE_CONNECT_CLIENT_ID"

    # ─── Razorpay platform ───
    "mbs-paycraft-razorpay-key-id:RAZORPAY_KEY_ID"
    "mbs-paycraft-razorpay-key-secret:RAZORPAY_KEY_SECRET"
    "mbs-paycraft-razorpay-webhook-secret:RAZORPAY_WEBHOOK_SECRET"

    # ─── Transactional email + observability ───
    "mbs-paycraft-resend-api-key:RESEND_API_KEY"
    "mbs-paycraft-sentry-dsn:NEXT_PUBLIC_SENTRY_DSN"
    "mbs-paycraft-sentry-auth-token:SENTRY_AUTH_TOKEN"

    # ─── OAuth (Supabase Auth → Google) ───
    "mbs-paycraft-google-oauth-client-id:GOOGLE_OAUTH_CLIENT_ID"
    "mbs-paycraft-google-oauth-secret:GOOGLE_OAUTH_SECRET"

    # ─── Framework Supabase project (URL + keys) ───
    "framework-supabase-url:NEXT_PUBLIC_SUPABASE_URL"
    "framework-supabase-anon-key:NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "framework-supabase-service-role-key:SUPABASE_SERVICE_ROLE_KEY"

    # ─── Tenant provider-key encryption (server-side AES) — added 2026-06-17 ───
    "mbs-paycraft-encryption-key:PAYCRAFT_ENCRYPTION_KEY"

    # ─── Phase 3 DR backup credentials (Cloudflare R2, S3-compatible) ───
    "mbs-paycraft-r2-access-key-id:R2_ACCESS_KEY_ID"
    "mbs-paycraft-r2-secret-access-key:R2_SECRET_ACCESS_KEY"
    "mbs-paycraft-r2-endpoint:R2_ENDPOINT_URL"

    # ─── Phase 4 support ticketing (Linear fan-out + Resend auto-reply) ───
    "mbs-paycraft-linear-api-key:LINEAR_API_KEY"
)

# Tmp dir for ephemeral secret files (mode 0700, auto-cleaned)
TMPDIR=$(mktemp -d -t paycraft-vercel-sync-XXXXXX)
chmod 700 "$TMPDIR"
trap "rm -rf $TMPDIR" EXIT

echo "═══════════════════════════════════════════════════════════════"
echo "  PayCraft → Vercel env sync"
echo "  target env: $ENV_TARGET"
echo "  mode:       $([ "$APPLY" = true ] && echo "APPLY" || echo "DRY-RUN")"
echo "  secrets:    ${#SECRETS[@]}"
echo "═══════════════════════════════════════════════════════════════"

cd "$(dirname "${BASH_SOURCE[0]}")/../dashboard" || {
    echo "ERROR: dashboard/ directory not found" >&2
    exit 1
}

# Verify Vercel project linked
if [[ ! -f ".vercel/project.json" ]]; then
    echo "ERROR: dashboard/.vercel/project.json missing — run 'vercel link' first" >&2
    exit 1
fi

for entry in "${SECRETS[@]}"; do
    alias="${entry%%:*}"
    env_name="${entry##*:}"

    tmpfile="$TMPDIR/${alias}.value"

    # Pull secret to tmpfile (NEVER stdout — SV32 compliant).
    # secrets-get.sh takes the alias as positional, not as --alias, AND
    # resolves the vault relative to its own cwd, so we run it FROM the
    # framework root (we're currently chdir'd into dashboard/ for the
    # vercel CLI call further down).
    if ! ( cd "$FW_ROOT" && bash "core/scripts/secrets-get.sh" \
                "$alias" --to-file "$tmpfile" >/dev/null 2>&1 ); then
        echo "  ✗ FAIL: ${alias} — vault entry missing or decrypt failed"
        continue
    fi

    if [[ ! -s "$tmpfile" ]]; then
        echo "  ⚠️  SKIP: ${alias} — empty value"
        continue
    fi

    if [[ "$APPLY" = true ]]; then
        # Remove existing first (vercel env add fails if name exists)
        vercel env rm "$env_name" "$ENV_TARGET" --yes 2>/dev/null || true

        # Add via stdin redirect (Vercel CLI accepts piped input)
        vercel env add "$env_name" "$ENV_TARGET" < "$tmpfile" >/dev/null 2>&1 && {
            echo "  ✓ SYNCED: ${env_name} → Vercel ${ENV_TARGET}"
        } || {
            echo "  ✗ FAIL:   ${env_name} → Vercel ${ENV_TARGET}"
        }
    else
        bytes=$(wc -c < "$tmpfile")
        echo "  [DRY] ${env_name} → Vercel ${ENV_TARGET}  (${bytes} bytes)"
    fi

    # Securely scrub tmpfile
    shred -u "$tmpfile" 2>/dev/null || rm -f "$tmpfile"
done

echo "═══════════════════════════════════════════════════════════════"
if [[ "$APPLY" = true ]]; then
    echo "  Done. Trigger a deploy to pick up new env vars:"
    echo "  cd dashboard && vercel --prod"
else
    echo "  Dry-run complete. Re-run with --apply to push."
fi
echo "═══════════════════════════════════════════════════════════════"
