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

# Walk up until the framework marker is found, rather than counting `..` levels. The hardcoded
# 7-deep relative path was off by one (it landed on the framework's PARENT) and, worse, silently
# encoded this file's exact nesting — any move of the repo layout re-breaks it with the same
# unhelpful error. Searching for the marker asserts the property we actually need.
FW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [[ "$FW_ROOT" != "/" && ! -f "${FW_ROOT}/core/scripts/secrets-get.sh" ]]; do
    FW_ROOT="$(dirname "$FW_ROOT")"
done
[[ -f "${FW_ROOT}/core/scripts/secrets-get.sh" ]] || {
    echo "ERROR: framework root not found above $(dirname "${BASH_SOURCE[0]}")" >&2
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
    "mbs-stripe-platform-secret-key:STRIPE_SECRET_KEY"
    "mbs-stripe-platform-webhook-secret:STRIPE_WEBHOOK_SECRET"
    "mbs-razorpay-key-id:RAZORPAY_KEY_ID"
    "mbs-razorpay-key-secret:RAZORPAY_KEY_SECRET"
    "mbs-razorpay-webhook-secret:RAZORPAY_WEBHOOK_SECRET"
    "paycraft-resend-api-key:RESEND_API_KEY"
    "paycraft-encryption-key:PAYCRAFT_ENCRYPTION_KEY"
)

# The Supabase CLI needs an access token, and every `secrets set` here failed with
# "Access token not provided" — reported only as a bare "FAIL" because the apply path greps the
# CLI output for a success word and discards the rest. The token is already in the vault, so
# resolve it rather than depending on an ambient `supabase login` that CI will not have.
# mlwfgytjxlqyfxcgpysm is the framework-supabase project, hence the framework-scoped alias.
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    _tok_file="$(bash "${FW_ROOT}/core/scripts/secrets-get.sh" \
        framework-supabase-access-token --secure-temp 2>/dev/null)" || _tok_file=""
    if [[ -n "$_tok_file" && -s "$_tok_file" ]]; then
        SUPABASE_ACCESS_TOKEN="$(<"$_tok_file")"
        export SUPABASE_ACCESS_TOKEN
        shred -u "$_tok_file" 2>/dev/null || rm -f "$_tok_file"
    else
        echo "ERROR: no SUPABASE_ACCESS_TOKEN and vault alias framework-supabase-access-token" >&2
        echo "       could not be resolved. Run: /secrets handoff for that alias." >&2
        exit 1
    fi
fi

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

    # The alias is POSITIONAL; `--alias` is not a flag secrets-get.sh accepts, so every lookup
    # failed with `unknown flag`. It was reported as "vault entry missing or decrypt failed"
    # because the call was piped into grep — the `||` then tested GREP's status, and the real
    # stderr was rewritten into a diagnosis that sent the reader to the vault instead of here.
    # Capture the actual status and surface the actual message.
    if ! get_err="$(bash "${FW_ROOT}/core/scripts/secrets-get.sh" \
        "$alias" --to-file "$tmpfile" 2>&1)"; then
        echo "  ✗ FAIL: ${alias} — ${get_err:-secrets-get.sh failed with no output}"
        continue
    fi

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

        # Trust the CLI's exit status, not a grep for a success word in its output. The grep
        # both mis-reports (any line containing "set" reads as success) and destroys the
        # diagnosis on failure -- "Access token not provided" surfaced here as a bare FAIL.
        # The CLI does not echo secret values, so its stderr is safe to show.
        if set_err="$(supabase secrets set --env-file "$envfile" 2>&1)"; then
            echo "  ✓ SYNCED: ${secret_name} → Supabase Edge Functions"
        else
            echo "  ✗ FAIL:   ${secret_name} → ${set_err##*$'\n'}"
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
