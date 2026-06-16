#!/usr/bin/env bash
#
# sync-to-supabase.sh — pull PayCraft Edge Function secrets from framework vault and set them
# on the framework Supabase project via `supabase secrets set`.
#
# RULE-SECRETS-VAULT-001 compliant:
# - Never writes secret values to disk except as ephemeral tmpfiles (mode 0600, deleted on exit)
# - Never echoes values to stdout
# - Uses secrets-get.sh --to-file (SV32) to avoid CLAUDECODE=1 stdout sink
#
# PayCraft uses the FRAMEWORK Supabase project (mlwfgytjxlqyfxcgpysm).
# Edge Functions live in supabase/functions/{stripe-webhook,razorpay-webhook,...}.
# These secrets are read by Deno via `Deno.env.get(...)` at runtime.
#
# Prereqs:
#   1. Webhook + encryption secrets pushed to vault (see secrets-push-checklist.md)
#   2. Supabase CLI installed:  brew install supabase/tap/supabase
#   3. Logged in:               supabase login
#   4. Project linked:          cd source/PayCraft && supabase link --project-ref mlwfgytjxlqyfxcgpysm
#
# Usage:
#   bash infra/sync-to-supabase.sh                  # dry-run (default)
#   bash infra/sync-to-supabase.sh --apply          # actually push
#
set -euo pipefail

FW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../../.." && pwd)"
[[ -f "${FW_ROOT}/core/scripts/secrets-get.sh" ]] || {
    echo "ERROR: framework root not found at ${FW_ROOT}" >&2
    exit 1
}

APPLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)        APPLY=true; shift ;;
        --dry-run)      APPLY=false; shift ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

# Edge Function-side secrets only (NOT all dashboard env vars).
# Format: ALIAS:SUPABASE_SECRET_NAME
EDGE_SECRETS=(
    "mbs-paycraft-stripe-platform-secret-key:STRIPE_SECRET_KEY"
    "mbs-paycraft-stripe-platform-webhook-secret:STRIPE_WEBHOOK_SECRET"
    "mbs-paycraft-stripe-connect-client-id:STRIPE_CONNECT_CLIENT_ID"
    "mbs-paycraft-razorpay-key-id:RAZORPAY_KEY_ID"
    "mbs-paycraft-razorpay-key-secret:RAZORPAY_KEY_SECRET"
    "mbs-paycraft-razorpay-webhook-secret:RAZORPAY_WEBHOOK_SECRET"
    "mbs-paycraft-resend-api-key:RESEND_API_KEY"
    "mbs-paycraft-encryption-key:PAYCRAFT_ENCRYPTION_KEY"
)

TMPDIR=$(mktemp -d -t paycraft-supabase-sync-XXXXXX)
chmod 700 "$TMPDIR"
trap "rm -rf $TMPDIR" EXIT

echo "═══════════════════════════════════════════════════════════════"
echo "  PayCraft → Supabase Edge Function secrets sync"
echo "  project:    framework-supabase (mlwfgytjxlqyfxcgpysm)"
echo "  mode:       $([ "$APPLY" = true ] && echo "APPLY" || echo "DRY-RUN")"
echo "  secrets:    ${#EDGE_SECRETS[@]}"
echo "═══════════════════════════════════════════════════════════════"

cd "$(dirname "${BASH_SOURCE[0]}")/.." || {
    echo "ERROR: source/PayCraft directory not found" >&2
    exit 1
}

# Verify Supabase project linked
if [[ ! -f "supabase/.temp/project-ref" ]] && [[ ! -f "supabase/config.toml" ]]; then
    echo "ERROR: Supabase project not linked — run 'supabase link --project-ref mlwfgytjxlqyfxcgpysm' first" >&2
    exit 1
fi

for entry in "${EDGE_SECRETS[@]}"; do
    alias="${entry%%:*}"
    secret_name="${entry##*:}"

    tmpfile="$TMPDIR/${alias}.value"

    bash "${FW_ROOT}/core/scripts/secrets-get.sh" \
        --alias "$alias" \
        --to-file "$tmpfile" \
        2>&1 | grep -v "^[[:space:]]*$" || {
        echo "  ✗ FAIL: ${alias} — vault entry missing or decrypt failed"
        continue
    }

    if [[ ! -s "$tmpfile" ]]; then
        echo "  ⚠️  SKIP: ${alias} — empty value"
        continue
    fi

    if [[ "$APPLY" = true ]]; then
        # supabase secrets set --env-file expects KEY=VALUE format
        # We use NAME=$(cat tmpfile) but that re-exposes — instead use stdin pattern:
        # supabase secrets set NAME --value-from-stdin (when CLI supports it)
        # Fallback: use --env-file with single-line tmpfile
        envfile="$TMPDIR/${alias}.env"
        printf '%s=%s\n' "$secret_name" "$(cat "$tmpfile")" > "$envfile"
        chmod 600 "$envfile"

        if supabase secrets set --env-file "$envfile" 2>&1 | grep -qE "(Finished|set)"; then
            echo "  ✓ SYNCED: ${secret_name} → Supabase Edge Functions"
        else
            echo "  ✗ FAIL:   ${secret_name} → Supabase Edge Functions"
        fi
        shred -u "$envfile" 2>/dev/null || rm -f "$envfile"
    else
        bytes=$(wc -c < "$tmpfile")
        echo "  [DRY] ${secret_name} → Supabase  (${bytes} bytes)"
    fi

    shred -u "$tmpfile" 2>/dev/null || rm -f "$tmpfile"
done

echo "═══════════════════════════════════════════════════════════════"
if [[ "$APPLY" = true ]]; then
    echo "  Done. Verify with: supabase secrets list"
else
    echo "  Dry-run complete. Re-run with --apply to push."
fi
echo "═══════════════════════════════════════════════════════════════"
