#!/usr/bin/env bash
#
# bootstrap.sh — Phase 0 of /paycraft-deploy.
#
# Detects missing prereqs and installs/configures them inline. Idempotent —
# each step skips if already satisfied.
#
# Sub-phases (each step is an autonomous check + auto-fix):
#   0.1 CLI INSTALL          — vercel, supabase, gh, jq
#   0.2 AUTH                 — vercel login, supabase login, gh auth login (prompts)
#   0.3 PROJECT LINK         — vercel link (dashboard), supabase link (project ref)
#   0.4 ACCOUNTS             — Resend (open browser + prompt for API key)
#   0.5 SECRETS COLLECT      — interactive Pattern 5 walk per MISSING vault secret
#   0.6 DASHBOARD NPM        — npm install (creates dashboard/node_modules)
#   0.7 SUPABASE PROJECT     — verify framework-supabase reachable
#
# Usage:
#   bootstrap.sh                     — interactive (prompts for everything missing)
#   bootstrap.sh --check-only        — report what's missing, don't auto-fix
#   bootstrap.sh --non-interactive   — fail on anything that needs human input
#   bootstrap.sh --skip <substep>    — skip specific sub-phase (csv)
#
set -eo pipefail

PAYCRAFT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FW_ROOT="$(cd "$PAYCRAFT_SRC/../../../../.." && pwd)"

CHECK_ONLY=false
NON_INTERACTIVE=false
SKIP_LIST=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --check-only)        CHECK_ONLY=true; shift ;;
        --non-interactive)   NON_INTERACTIVE=true; shift ;;
        --skip)              SKIP_LIST="$2"; shift 2 ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

# ═══════════════════════════════════════════════════════════
# Output helpers
# ═══════════════════════════════════════════════════════════
substep() {
    local id="$1" name="$2"
    if [[ ",$SKIP_LIST," == *",$id,"* ]]; then
        echo "  ↷ Sub-step $id: $name — SKIPPED (--skip)"
        return 1
    fi
    echo ""
    echo "  ▶ Sub-step $id: $name"
}

ok()    { echo "    ✓ $*"; }
warn()  { echo "    ⚠ $*"; }
fail()  { echo "    ✗ $*" >&2; }
info()  { echo "    · $*"; }
prompt() { printf "    ? %s " "$*"; }

# ═══════════════════════════════════════════════════════════
# Sub-step 0.1 — CLI INSTALL
# ═══════════════════════════════════════════════════════════
sub_0_1_cli_install() {
    substep "0.1" "CLI INSTALL (vercel, supabase, gh, jq)" || return 0

    # vercel
    if command -v vercel >/dev/null 2>&1; then
        ok "vercel CLI installed ($(vercel --version 2>/dev/null | head -1))"
    else
        if [[ "$CHECK_ONLY" = "true" ]]; then
            fail "vercel CLI missing — install: npm i -g vercel"
            return 1
        fi
        info "Installing vercel CLI globally via npm..."
        npm i -g vercel 2>&1 | tail -3 || { fail "vercel install failed"; return 1; }
        ok "vercel CLI installed"
    fi

    # supabase
    if command -v supabase >/dev/null 2>&1; then
        ok "supabase CLI installed ($(supabase --version 2>/dev/null | head -1))"
    else
        if [[ "$CHECK_ONLY" = "true" ]]; then
            fail "supabase CLI missing"
            return 1
        fi
        info "Installing supabase CLI via Homebrew..."
        if command -v brew >/dev/null 2>&1; then
            brew install supabase/tap/supabase 2>&1 | tail -3 || { fail "supabase install failed"; return 1; }
        else
            fail "Homebrew not found — install supabase CLI manually: https://supabase.com/docs/guides/cli"
            return 1
        fi
        ok "supabase CLI installed"
    fi

    # gh (used for webhook setup later, optional)
    if command -v gh >/dev/null 2>&1; then
        ok "gh CLI installed"
    else
        warn "gh CLI not installed (optional, used for some sub-steps)"
    fi

    # jq (used for parsing API responses)
    if command -v jq >/dev/null 2>&1; then
        ok "jq installed"
    else
        if [[ "$CHECK_ONLY" = "true" ]]; then
            warn "jq missing — install: brew install jq"
            return 0
        fi
        info "Installing jq via Homebrew..."
        command -v brew >/dev/null 2>&1 && brew install jq 2>&1 | tail -2 || warn "jq install failed (non-critical)"
    fi
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.2 — AUTHENTICATE
# ═══════════════════════════════════════════════════════════
sub_0_2_auth() {
    substep "0.2" "AUTHENTICATE (vercel, supabase)" || return 0

    # vercel whoami
    if vercel whoami >/dev/null 2>&1; then
        ok "vercel logged in as $(vercel whoami 2>/dev/null)"
    else
        if [[ "$NON_INTERACTIVE" = "true" || "$CHECK_ONLY" = "true" ]]; then
            fail "vercel not logged in — run: vercel login"
            return 1
        fi
        info "Opening vercel login (browser-based OAuth)..."
        vercel login 2>&1 | tail -10 || { fail "vercel login failed"; return 1; }
        ok "vercel logged in"
    fi

    # supabase — framework-canonical: vault-mediated db-url, no `supabase login` needed
    # ('supabase login' is only required for personal-PAT-driven `db push --linked`;
    # we use `--db-url $framework-supabase-db-url` in Phase 3 instead.)
    local sb_check
    sb_check=$(mktemp -t paycraft-sb-check-XXXXXX)
    if bash "$FW_ROOT/core/scripts/secrets-get.sh" framework-supabase-db-url --to-file "$sb_check" 2>/dev/null; then
        rm -f "$sb_check"
        ok "framework-supabase reachable via vault (no supabase login required)"
    else
        rm -f "$sb_check"
        fail "framework-supabase-db-url not in vault — push via /secrets push or run /secrets adopt"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.3 — PROJECT LINK
# ═══════════════════════════════════════════════════════════
FRAMEWORK_SUPABASE_PROJECT_REF="mlwfgytjxlqyfxcgpysm"

sub_0_3_link() {
    substep "0.3" "PROJECT LINK (vercel + supabase)" || return 0

    # vercel link (dashboard)
    if [[ -f "$PAYCRAFT_SRC/dashboard/.vercel/project.json" ]]; then
        local proj
        proj=$(jq -r '.projectId // "unknown"' "$PAYCRAFT_SRC/dashboard/.vercel/project.json" 2>/dev/null || echo "unknown")
        ok "vercel project linked (projectId: $proj)"
    else
        if [[ "$NON_INTERACTIVE" = "true" || "$CHECK_ONLY" = "true" ]]; then
            fail "vercel project not linked — run: cd dashboard && vercel link"
            return 1
        fi
        info "Linking dashboard to Vercel project..."
        cd "$PAYCRAFT_SRC/dashboard" && vercel link --yes 2>&1 | tail -5 || {
            fail "vercel link failed — try manually: cd dashboard && vercel link"
            return 1
        }
        ok "vercel project linked"
    fi

    # supabase link (project ref is fixed for framework-supabase)
    if [[ -f "$PAYCRAFT_SRC/supabase/.temp/project-ref" ]] && \
       [[ "$(cat "$PAYCRAFT_SRC/supabase/.temp/project-ref" 2>/dev/null)" = "$FRAMEWORK_SUPABASE_PROJECT_REF" ]]; then
        ok "supabase project linked (ref: $FRAMEWORK_SUPABASE_PROJECT_REF)"
    else
        if [[ "$CHECK_ONLY" = "true" ]]; then
            fail "supabase project not linked"
            return 1
        fi
        info "Linking source/PayCraft to framework-supabase project..."
        cd "$PAYCRAFT_SRC" && supabase link --project-ref "$FRAMEWORK_SUPABASE_PROJECT_REF" 2>&1 | tail -3 || {
            fail "supabase link failed — check your supabase login + project-ref"
            return 1
        }
        ok "supabase project linked (ref: $FRAMEWORK_SUPABASE_PROJECT_REF)"
    fi
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.4 — ACCOUNTS CHECK (Resend only — Sentry deferred for v1)
# ═══════════════════════════════════════════════════════════
sub_0_4_accounts() {
    substep "0.4" "FREE-TIER ACCOUNTS (Resend)" || return 0

    # We can't programmatically check whether the user has the Resend account,
    # but we can check whether the corresponding secret is vaulted (sub-step 0.5).
    # This sub-step just nudges if Resend is missing.

    local resend_missing=false
    bash "$FW_ROOT/core/scripts/secrets-get.sh" mbs-paycraft-resend-api-key --to-file /tmp/__r4chk 2>/dev/null && rm -f /tmp/__r4chk || resend_missing=true

    if [[ "$resend_missing" = "true" ]]; then
        warn "Resend API key not yet vaulted — you'll need an account at https://resend.com (free 3K/mo)"
        if [[ "$NON_INTERACTIVE" != "true" && "$CHECK_ONLY" != "true" ]]; then
            prompt "Open Resend signup in browser now? [y/N]: "
            read -r r; [[ "$r" = "y" || "$r" = "Y" ]] && (command -v open >/dev/null && open "https://resend.com/signup" || info "Visit https://resend.com/signup manually")
        fi
    else
        ok "Resend API key already in vault"
    fi
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.5 — SECRETS COLLECT (interactive Pattern 5)
# ═══════════════════════════════════════════════════════════
# Map: ALIAS:HUMAN_DESCRIPTION:PROVIDER_URL
SECRETS_TO_COLLECT=(
    "mbs-paycraft-stripe-platform-secret-key:Stripe Secret Key (sk_live_*):https://dashboard.stripe.com/apikeys"
    "mbs-paycraft-stripe-platform-publishable-key:Stripe Publishable Key (pk_live_*):https://dashboard.stripe.com/apikeys"
    "mbs-paycraft-stripe-platform-webhook-secret:Stripe Webhook Signing Secret (whsec_*):https://dashboard.stripe.com/webhooks"
    "mbs-paycraft-razorpay-key-id:Razorpay Key ID (rzp_live_*):https://dashboard.razorpay.com/app/keys"
    "mbs-paycraft-razorpay-key-secret:Razorpay Key Secret:https://dashboard.razorpay.com/app/keys"
    "mbs-paycraft-resend-api-key:Resend API Key (re_*):https://resend.com/api-keys"
    "mbs-paycraft-vercel-token:Vercel Token (Account Settings → Tokens):https://vercel.com/account/tokens"
    "mbs-paycraft-vercel-org-id:Vercel Org ID (Account Settings):https://vercel.com/account"
    "mbs-paycraft-vercel-project-id:Vercel Project ID (Project Settings → General):https://vercel.com/dashboard"
)

push_secret_via_stdin() {
    local secret_id="$1" value="$2"
    if [[ -z "$value" ]]; then
        fail "Empty value for $secret_id — skipping"
        return 1
    fi
    printf '%s' "$value" | bash "$FW_ROOT/core/scripts/secrets-push.sh" \
        --vault mbs \
        --secret-id "$secret_id" \
        --stdin \
        --account-email mobilebytesensei@gmail.com 2>&1 | tail -2
}

sub_0_5_secrets_collect() {
    substep "0.5" "VAULT SECRETS (interactive collect for missing)" || return 0

    local missing_count=0 collected_count=0 already_count=0

    # Generated secret first: encryption key (no user input needed)
    local __enc_chk; __enc_chk=$(mktemp -t enc-chk-XXXXXX); chmod 600 "$__enc_chk"
    if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" mbs-paycraft-encryption-key --to-file "$__enc_chk" 2>/dev/null; then
        rm -f "$__enc_chk"
        if [[ "$CHECK_ONLY" = "true" ]]; then
            warn "Encryption key not yet vaulted"
            missing_count=$((missing_count + 1))
        elif [[ "$NON_INTERACTIVE" = "true" ]]; then
            fail "Encryption key missing and --non-interactive — generate manually"
            return 1
        else
            info "Auto-generating AES-256 encryption key..."
            local enc_key
            enc_key=$(openssl rand -base64 32)
            push_secret_via_stdin "paycraft-encryption-key" "$enc_key" && ok "encryption key pushed to vault"
            unset enc_key
            collected_count=$((collected_count + 1))
        fi
    else
        rm -f "$__enc_chk"
        ok "encryption key already in vault"
        already_count=$((already_count + 1))
    fi

    # The 13 user-input secrets
    for entry in "${SECRETS_TO_COLLECT[@]}"; do
        IFS=':' read -r alias desc url <<< "$entry"
        # The secret_id is the alias without the mbs-paycraft- prefix
        local secret_id="${alias#mbs-paycraft-}"
        secret_id="paycraft-${secret_id}"

        local __chk; __chk=$(mktemp -t v-chk-XXXXXX); chmod 600 "$__chk"
        if bash "$FW_ROOT/core/scripts/secrets-get.sh" "$alias" --to-file "$__chk" 2>/dev/null; then
            rm -f "$__chk"
            ok "$alias already in vault"
            already_count=$((already_count + 1))
            continue
        fi
        rm -f "$__chk"

        if [[ "$CHECK_ONLY" = "true" ]]; then
            warn "MISSING: $alias ($desc)"
            missing_count=$((missing_count + 1))
            continue
        fi

        if [[ "$NON_INTERACTIVE" = "true" ]]; then
            fail "$alias missing and --non-interactive — push via secrets-push.sh"
            return 1
        fi

        # Interactive collection
        echo ""
        echo "    ┌─ $desc"
        echo "    │  Get value from: $url"
        if command -v open >/dev/null 2>&1; then
            prompt "Open provider URL in browser? [y/N/s=skip]: "
            read -r r
            if [[ "$r" = "s" ]]; then
                warn "Skipped — re-run later or push via /secrets push $secret_id"
                missing_count=$((missing_count + 1))
                continue
            fi
            [[ "$r" = "y" || "$r" = "Y" ]] && open "$url"
        fi
        printf "    │  Paste value (hidden input), then Enter: "
        # shellcheck disable=SC2162  # we want no -r so users can paste with backslashes
        read -s val
        echo ""

        if [[ -z "$val" ]]; then
            warn "Empty value — skipping $alias"
            missing_count=$((missing_count + 1))
            continue
        fi

        if push_secret_via_stdin "$secret_id" "$val"; then
            ok "pushed to vault"
            collected_count=$((collected_count + 1))
        else
            fail "push failed for $secret_id"
            missing_count=$((missing_count + 1))
        fi
        unset val
    done

    echo ""
    info "Vault summary: $already_count already / $collected_count collected / $missing_count missing"
    if [[ $missing_count -gt 0 && "$CHECK_ONLY" != "true" ]]; then
        warn "$missing_count secrets still missing — deploy will fail at phase 1"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.6 — DASHBOARD NPM
# ═══════════════════════════════════════════════════════════
sub_0_6_npm() {
    substep "0.6" "DASHBOARD NPM INSTALL" || return 0

    if [[ ! -f "$PAYCRAFT_SRC/dashboard/package-lock.json" ]]; then
        fail "dashboard/package-lock.json missing — should be committed (see PR #62)"
        return 1
    fi

    if [[ -d "$PAYCRAFT_SRC/dashboard/node_modules" ]]; then
        ok "dashboard/node_modules present"
        return 0
    fi

    if [[ "$CHECK_ONLY" = "true" ]]; then
        warn "dashboard/node_modules missing — would run: cd dashboard && npm ci"
        return 0
    fi

    info "Running npm ci in dashboard/..."
    cd "$PAYCRAFT_SRC/dashboard" && npm ci --no-audit --no-fund 2>&1 | tail -3 || {
        fail "npm ci failed"
        return 1
    }
    ok "dashboard deps installed"
}

# ═══════════════════════════════════════════════════════════
# Sub-step 0.7 — FRAMEWORK SUPABASE REACHABLE
# ═══════════════════════════════════════════════════════════
sub_0_7_supabase_reach() {
    substep "0.7" "FRAMEWORK-SUPABASE REACHABILITY" || return 0

    local url_file url
    url_file=$(mktemp -t paycraft-sb-url-XXXXXX)
    trap "rm -f $url_file" RETURN
    if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" framework-supabase-url --to-file "$url_file" 2>/dev/null; then
        warn "framework-supabase-url not resolvable (vault entry missing?)"
        return 1
    fi
    url=$(cat "$url_file")
    if [[ -z "$url" ]]; then
        warn "framework-supabase-url empty in vault"
        return 1
    fi
    # Any HTTP response (incl. 401/403 from dummy apikey) means the endpoint is up;
    # we're testing TCP+TLS reachability, not auth.
    local http
    http=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$url/rest/v1/" -H "apikey: dummy" 2>/dev/null || echo "000")
    if [[ "$http" =~ ^[1-5][0-9][0-9]$ ]]; then
        ok "framework-supabase reachable at $url (HTTP $http)"
    else
        fail "framework-supabase unreachable — check network + URL (got: $http)"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════
echo "═══════════════════════════════════════════════════════════════"
echo "  /paycraft-deploy — Phase 0: BOOTSTRAP"
echo "  mode: $([[ $CHECK_ONLY = true ]] && echo CHECK-ONLY || ([[ $NON_INTERACTIVE = true ]] && echo NON-INTERACTIVE || echo INTERACTIVE))"
echo "═══════════════════════════════════════════════════════════════"

OVERALL_RC=0

sub_0_1_cli_install         || OVERALL_RC=$?
sub_0_2_auth                || OVERALL_RC=$?
sub_0_3_link                || OVERALL_RC=$?
sub_0_4_accounts            # informational only, never fails
sub_0_5_secrets_collect     || OVERALL_RC=$?
sub_0_6_npm                 || OVERALL_RC=$?
sub_0_7_supabase_reach      || OVERALL_RC=$?

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ $OVERALL_RC -eq 0 ]]; then
    echo "  ✓ Phase 0 (BOOTSTRAP) — all sub-steps passed. Ready for deploy."
else
    echo "  ✗ Phase 0 (BOOTSTRAP) — exit $OVERALL_RC. Fix above issues then re-run."
fi
echo "═══════════════════════════════════════════════════════════════"
exit $OVERALL_RC
