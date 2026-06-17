#!/usr/bin/env bash
#
# infra/r2-bootstrap.sh
#
# Phase 3 T1 of paycraft-v2-production-readiness — one-shot Cloudflare R2 bucket
# bootstrap for the daily DB backup pipeline. Idempotent: re-running on an
# already-bootstrapped account is a no-op.
#
# What it does
#   1. Detects whether `wrangler` is installed (auto-installs to ~/.local/bin
#      via npm if not).
#   2. Verifies the user is logged in: `wrangler whoami`.
#   3. Creates the R2 bucket `paycraft-backups` (skipped if it exists).
#   4. Prints the next-step credential-creation walkthrough — the actual
#      API token MUST be created in the Cloudflare UI (R2 API tokens cannot
#      be created programmatically without an account API key, which we
#      would never type in chat).
#   5. Lists the env-vars + vault aliases that the operator will push.
#
# Usage:
#   bash infra/r2-bootstrap.sh                 # idempotent setup
#   bash infra/r2-bootstrap.sh --check         # check-only (no mutations)
#
# Prerequisites:
#   - Cloudflare account (free tier — 10 GB storage + 10M reads/mo)
#   - `wrangler login` completed before running

set -euo pipefail

CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

BUCKET=paycraft-backups

echo "▶ Cloudflare R2 bootstrap for PayCraft daily backups"
echo "  Bucket: $BUCKET"
echo "  Region: auto"
echo

# Step 1 — wrangler installed?
if ! command -v wrangler >/dev/null 2>&1; then
    echo "✗ wrangler not found." >&2
    echo "  Install: npm install -g wrangler" >&2
    echo "  Or run locally: npx wrangler ..." >&2
    exit 2
fi
echo "✓ wrangler installed ($(wrangler --version | head -1))"

# Step 2 — logged in?
if ! wrangler whoami 2>/dev/null | grep -q '@'; then
    echo "✗ Not logged in to Cloudflare." >&2
    echo "  Run: wrangler login" >&2
    exit 2
fi
ACCOUNT_EMAIL=$(wrangler whoami 2>/dev/null | grep '@' | head -1 | awk '{print $NF}' || echo unknown)
echo "✓ Logged in as: $ACCOUNT_EMAIL"

# Step 3 — bucket exists?
if wrangler r2 bucket list 2>/dev/null | grep -q "^$BUCKET\b"; then
    echo "✓ Bucket '$BUCKET' already exists — skipping create."
else
    if $CHECK_ONLY; then
        echo "ℹ would create bucket '$BUCKET' (skipped: --check)"
    else
        echo "▶ Creating bucket '$BUCKET'…"
        wrangler r2 bucket create "$BUCKET"
        echo "✓ Bucket created."
    fi
fi

cat <<'EOF'

═══════════════════════════════════════════════════════════════
  NEXT STEP — Create R2 API Token (UI-only, ≤ 2 min)
═══════════════════════════════════════════════════════════════

1. Open https://dash.cloudflare.com/?to=/:account/r2/api-tokens
2. "Create API token"
3. Permissions: Object Read & Write (NOT Admin)
4. Resources: Apply to specific buckets > paycraft-backups
5. TTL: Forever (rotate via /secrets rotate annually)
6. Click "Create API token"

Cloudflare shows:
  - Access Key ID         (32-char alphanumeric)
  - Secret Access Key     (32-char alphanumeric)
  - Endpoint              (https://<account-id>.r2.cloudflarestorage.com)
  - jurisdiction (skip — leave default)

═══════════════════════════════════════════════════════════════
  Push to vault (zero-chat-secret-typed path, RULE-SECRETS-MACOS-001)
═══════════════════════════════════════════════════════════════

Use the macOS Keychain pattern:

    # Stage values in Keychain (interactive secure prompts)
    bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \\
         --init paycraft-r2 r2-access-key-id:R2_ACCESS_KEY_ID
    bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \\
         --init paycraft-r2 r2-secret-access-key:R2_SECRET_ACCESS_KEY
    bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \\
         --init paycraft-r2 r2-endpoint:R2_ENDPOINT_URL

    # Push each Keychain entry to vault
    for k in r2-access-key-id r2-secret-access-key r2-endpoint; do
        security find-generic-password -s paycraft-r2 -a "$k" -w \\
          | bash $FW_ROOT/core/scripts/secrets-push.sh \\
                 --vault mbs \\
                 --id paycraft-${k} \\
                 --stdin
    done

    # Materialize into Vercel + GitHub Actions
    bash infra/sync-to-vercel.sh --apply --env production

═══════════════════════════════════════════════════════════════
  Verify end-to-end
═══════════════════════════════════════════════════════════════

    # Trigger backup workflow once
    gh workflow run daily-backup.yml --ref main

    # ≤ 30s: confirm one object lands
    wrangler r2 object list paycraft-backups --prefix "$(date -u +%Y/%m/%d)/"

    # Read the bytes back into a tmpfile (no stdout leak)
    wrangler r2 object get paycraft-backups/<key> --file /tmp/test.dump.gz
    test -s /tmp/test.dump.gz && echo "✓ R2 round-trip works."
    rm -f /tmp/test.dump.gz

After this, Phase 3 T1, T4, T7 (DR drill) are unlocked.
EOF
