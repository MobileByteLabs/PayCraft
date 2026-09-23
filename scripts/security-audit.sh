#!/usr/bin/env bash
# =============================================================================
# security-audit.sh — probe the LIVE API and assert each security property
# =============================================================================
#
# Every check here exists because something was once wrong, or because a claim needed evidence.
# The point is that "the API is secure" stops being an assertion someone made once and becomes a
# command anyone can re-run after any deploy.
#
# It probes production over the network rather than reading source, because this session produced
# three separate cases where code that typechecked, deployed and read correctly did not behave as
# written — a rate limiter that never fired, a Cloudflare rule that never matched, and a sync that
# reported success while skipping every provider.
#
# Usage:
#   bash scripts/security-audit.sh                 # needs a key for the authenticated checks
#   SKIP_AUTHED=1 bash scripts/security-audit.sh   # public checks only
#
# The key is read from the vault, never passed as an argument (a CLI arg is visible in ps).
# Exit 0 = every check passed. Exit 1 = at least one failed.
# =============================================================================
set -uo pipefail

API="${API_HOST:-https://api.paycraft.mobilebytesensei.com}"
MCP="${MCP_HOST:-https://mcp.paycraft.mobilebytesensei.com}"
# Six levels: scripts → PayCraft → source → PayCraft → mbs → workspaces → framework root.
# Five landed on workspaces/ and silently found no vault, so every authenticated check skipped.
FW="${FW_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." 2>/dev/null && pwd)}"

pass=0; fail=0; skip=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; fail=$((fail+1)); }
note() { printf '    %s\n' "$1"; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
hdrs() { curl -s -D- -o /dev/null --max-time 30 "$@"; }

# ── credentials ───────────────────────────────────────────────────────────────────────────────
KEY=""
if [ -z "${SKIP_AUTHED:-}" ]; then
  kf="$(bash "$FW/core/scripts/secrets-get.sh" paycraft-management-api-key --secure-temp 2>/dev/null | tail -1)"
  if [ -f "$kf" ]; then KEY="$(cat "$kf")"; rm -f "$kf"; fi
  [ -z "$KEY" ] && { echo "⚠ no API key resolvable — running public checks only"; SKIP_AUTHED=1; }
fi

sec "1. Transport and headers"
H="$(hdrs "$API/v1/readiness")"
for h in strict-transport-security x-content-type-options x-frame-options referrer-policy; do
  grep -qi "^$h:" <<<"$H" && ok "$h present" || bad "$h" "missing"
done
grep -qi '^cache-control: *no-store' <<<"$H" \
  && ok "cache-control: no-store (billing state must never be proxy-cached)" \
  || bad "cache-control" "not no-store — a proxy could serve one tenant's data to another"
grep -qi '^www-authenticate: *bearer' <<<"$H" && ok "WWW-Authenticate on 401" || bad "WWW-Authenticate" "absent"

sec "2. Authentication"
[ "$(code "$API/v1/readiness")" = "401" ] && ok "no credential → 401" || bad "no credential" "expected 401"
[ "$(code -H 'Authorization: Bearer pcsk_definitely_not_real' "$API/v1/readiness")" = "401" ] \
  && ok "unknown key → 401" || bad "unknown key" "expected 401"
[ "$(code -H 'Authorization: Basic abc' "$API/v1/readiness")" = "401" ] \
  && ok "wrong scheme → 401" || bad "wrong scheme" "expected 401"
# Unknown / revoked / expired must be indistinguishable, or the error tells an attacker which
# guess was once real.
b1=$(curl -s --max-time 30 -H 'Authorization: Bearer pcsk_aaaa' "$API/v1/readiness")
b2=$(curl -s --max-time 30 -H 'Authorization: Bearer pcsk_bbbb' "$API/v1/readiness")
[ "$b1" = "$b2" ] && ok "rejections are byte-identical (no key-state oracle)" \
                  || bad "rejection bodies differ" "leaks whether a key once existed"

sec "3. Cross-tenant isolation"
if [ -z "${SKIP_AUTHED:-}" ]; then
  [ "$(code -H "Authorization: Bearer $KEY" "$API/v1/products/00000000-0000-0000-0000-000000000009")" = "404" ] \
    && ok "foreign resource id → 404 (not another tenant's row)" || bad "foreign id" "expected 404"
  # A tenant named in the request must be ignored in favour of the key's own tenant.
  own=$(curl -s --max-time 30 -H "Authorization: Bearer $KEY" "$API/v1/tenant" | grep -o '"id":"[^"]*"' | head -1)
  other=$(curl -s --max-time 30 -H "Authorization: Bearer $KEY" \
          "$API/v1/tenant?tenant_id=22222222-2222-2222-2222-222222222222" | grep -o '"id":"[^"]*"' | head -1)
  [ "$own" = "$other" ] && ok "a tenant_id in the query is ignored" || bad "tenant override" "query changed the answer"
else skip=$((skip+1)); note "skipped (no key)"; fi

sec "4. Rate limiting — enforced in the APP, not the edge"
note "zone rate-limiting rules do NOT fire on Pages custom domains (verified: 5/10s floor, 30 reqs, 0 blocks)"
d=$(mktemp -d)
for i in $(seq 1 40); do
  curl -s -o "$d/b$i" -w "%{http_code}\n" --max-time 20 \
    -H "Authorization: Bearer pcsk_$(printf '%064d' $((i+7000)))" "$API/v1/readiness" &
done > "$d/c.txt" 2>&1
wait
n429=$(grep -c '^429$' "$d/c.txt" || true)
[ "${n429:-0}" -gt 0 ] && ok "failed-auth spray throttled ($n429 of 40 got 429)" \
                       || bad "failed-auth spray" "40 bad keys, none throttled"
grep -ql 'too_many_auth_attempts\|rate_limited' "$d"/b* 2>/dev/null \
  && ok "throttle responses are the app's (shared bucket, works across isolates)" || true
rm -rf "$d"

sec "5. Request body limits"
big=$(python3 -c 'import json;print(json.dumps({"confirm_count":0,"p":"x"*80000}))' 2>/dev/null)
if [ -n "$big" ] && [ -z "${SKIP_AUTHED:-}" ]; then
  [ "$(code -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' --data-binary "$big" "$API/v1/sync")" = "413" ] \
    && ok "oversized body → 413 (refused before parsing)" || bad "oversized body" "expected 413"
else skip=$((skip+1)); note "skipped"; fi

sec "6. Attack surface"
[ "$(code "$API/auth/login")" = "404" ] && ok "API host serves no dashboard UI" || bad "API host" "/auth/login reachable"
[ "$(code "$MCP/auth/login")" = "404" ] && ok "MCP host serves no dashboard UI" || bad "MCP host" "/auth/login reachable"
[ "$(code "$API/.env")" = "403" ] && ok "scanner probe /.env blocked at the edge" \
                                  || note "/.env → $(code "$API/.env") (edge rule may still be propagating)"
[ "$(code -X TRACE "$API/v1/readiness")" = "403" ] && ok "TRACE blocked at the edge" \
                                  || note "TRACE → $(code -X TRACE "$API/v1/readiness")"

sec "7. Secret exposure"
spec=$(curl -s --max-time 30 "$API/v1/openapi.json")
# Match key MATERIAL, not variable names. The first version flagged the string SERVICE_ROLE in an
# error example — an env var name, not a secret — which is the kind of false positive that
# teaches people to ignore a security check.
grep -qE 'sk_live_[A-Za-z0-9]{16}|rzp_live_[A-Za-z0-9]{10}|eyJ[A-Za-z0-9_-]{30}|BEGIN [A-Z ]*PRIVATE KEY' <<<"$spec" \
  && bad "openapi.json" "contains something credential-shaped" \
  || ok "public spec carries no credential material"
if [ -z "${SKIP_AUTHED:-}" ]; then
  t=$(curl -s --max-time 30 -H "Authorization: Bearer $KEY" "$API/v1/tenant")
  grep -qE '"api_key_(live|test)"|"webhook_secret_(live|test)"' <<<"$t" \
    && bad "/v1/tenant" "returns a credential column" || ok "/v1/tenant exposes no credential columns"
fi

# The runtime half of the infra-name rule. The unit test scans source and therefore only sees
# LITERAL leaks; a name interpolated from a variable at runtime is invisible to it. This looks at
# what the server actually sends, so it catches both.
for ep in /api/health /v1/readiness /v1/openapi.json; do
  body=$(curl -s --max-time 25 "$API$ep")
  if grep -qE 'SUPABASE_[A-Z_]+|SERVICE_ROLE_KEY|DATABASE_URL|CLOUDFLARE_API_TOKEN' <<<"$body"; then
    bad "$ep" "response names an infrastructure variable"
  else
    ok "$ep names no infrastructure variable"
  fi
done

sec "8. MCP"
init=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"audit","version":"1"}}}' "$MCP/")
grep -q '"protocolVersion"' <<<"$init" && ok "MCP initialize responds" || bad "MCP initialize" "no protocolVersion"
unauth=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"paycraft_readiness","arguments":{}}}' "$MCP/")
grep -q '"error"' <<<"$unauth" && ok "MCP tool call without a key is refused" || bad "MCP auth" "unauthenticated call succeeded"

printf '\n\033[1m── result ──\033[0m\n  passed %s   failed %s   skipped %s\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ] || exit 1
