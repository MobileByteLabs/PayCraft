#!/usr/bin/env bash
#
# auth-allowlist-canary — RED/GREEN canary for deploy.sh phase 2.5 AUTH ALLOWLIST.
#
# Drives lib-auth-allowlist.sh with fixtures. No network, no Supabase project, no PAT.
#
# RED cases are the states that produced the live bug (staging sign-in landing on production) or
# that a careless fix would introduce. GREEN cases are the states that must stay silent, because a
# guard that fires on every run gets muted and then it is not a guard.
#
# Usage: bash run.sh            → prints per-case results, exit 0 all-pass / 1 any-fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../lib-auth-allowlist.sh"

STAGING_URL="https://staging.paycraft.pages.dev"
PROJECT="paycraft"
SPECIFIC="$STAGING_URL/**"
WILDCARD="https://*.paycraft.pages.dev/**"
PROD_ONLY="https://paycraft.mobilebytesensei.com/**,http://localhost:3000/**"

FAILS=0
ok()   { printf '  ✓ %s\n' "$1"; }
bad()  { printf '  ✗ %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; FAILS=$((FAILS+1)); }

# expect_missing <case> <allowlist> <expected newline-joined missing, or "">
expect_missing() {
    local name="$1" csv="$2" want="$3" got
    got="$(auth_allowlist_missing "$csv" "$STAGING_URL" "$PROJECT")"
    if [[ "$got" == "$want" ]]; then ok "$name"; else bad "$name" "${want:-<none>}" "${got:-<none>}"; fi
}

echo "─── RED: states where the guard MUST fire ──────────────────────"

# The exact live configuration when the bug was reported. Production + localhost only; staging
# sign-in silently fell back to site_url.
expect_missing "R1 prod+localhost only → proposes both entries" \
    "$PROD_ONLY" "$SPECIFIC
$WILDCARD"

# An empty allowlist is not "permissive", it is "nothing is allowed".
expect_missing "R2 empty allowlist → proposes both entries" \
    "" "$SPECIFIC
$WILDCARD"

# A near-miss that reads correct at a glance: right project, wrong host. This is what someone
# copying the production entry and editing it in a hurry produces.
expect_missing "R3 wrong host (pages.dev of another project) → still fires" \
    "https://*.paycraft-docs.pages.dev/**" "$SPECIFIC
$WILDCARD"

# Covers the alias but not the per-deployment hash hosts. Sign-in works on staging.…, then breaks
# the moment you open a specific build — the failure that looks intermittent.
expect_missing "R4 specific present, wildcard absent → proposes wildcard only" \
    "$PROD_ONLY,$SPECIFIC" "$WILDCARD"

# http:// is a different origin than https:// and must not satisfy the check.
expect_missing "R5 http (not https) staging entry → still fires" \
    "http://staging.paycraft.pages.dev/**" "$SPECIFIC
$WILDCARD"

echo ""
echo "─── GREEN: states where the guard MUST stay silent ─────────────"

# The configuration after the fix. Re-running must be a no-op.
expect_missing "G1 both entries present → nothing to add" \
    "$PROD_ONLY,$SPECIFIC,$WILDCARD" ""

# The wildcard genuinely covers the staging alias; re-adding the specific entry beside it is noise.
expect_missing "G2 wildcard alone covers staging → nothing to add" \
    "$PROD_ONLY,$WILDCARD" ""

# Whitespace after commas is what the Supabase dashboard produces when a human pastes a list.
# A space-prefixed pattern matches nothing, so untrimmed parsing would re-add duplicates forever.
expect_missing "G3 human-spaced list → trimmed, nothing to add" \
    "https://paycraft.mobilebytesensei.com/** , $SPECIFIC , $WILDCARD" ""

echo ""
echo "─── parse_uri_allow_list ───────────────────────────────────────"

# Single-line body behind supabase-connect.sh's banner line.
got="$(parse_uri_allow_list '▸ mgmt → mbs/PayCraft (ref abc)
{"site_url":"https://p.com","uri_allow_list":"a/**,b/**","x":1}')"
[[ "$got" = "a/**,b/**" ]] && ok "P1 parses past the banner line" || bad "P1 parses past the banner line" "a/**,b/**" "$got"

# Pretty-printed body — the field lands on its own line.
got="$(parse_uri_allow_list '{
  "site_url": "https://p.com",
  "uri_allow_list": "a/**,b/**"
}')"
[[ "$got" = "a/**,b/**" ]] && ok "P2 parses pretty-printed JSON" || bad "P2 parses pretty-printed JSON" "a/**,b/**" "$got"

# An unreadable response must yield EMPTY, never a plausible-looking value: the caller treats
# empty as "could not read" and refuses to PATCH, which is what stops a failed GET from wiping
# every existing entry off the project.
got="$(parse_uri_allow_list '{"message":"Cannot GET /v1/…"}')"
[[ -z "$got" ]] && ok "P3 error body → empty (caller must not PATCH)" || bad "P3 error body → empty" "<empty>" "$got"

echo ""
if [[ "$FAILS" -gt 0 ]]; then
    echo "FAIL: auth-allowlist-canary — $FAILS case(s)"
    exit 1
fi
echo "PASS: auth-allowlist-canary — all cases"
exit 0
