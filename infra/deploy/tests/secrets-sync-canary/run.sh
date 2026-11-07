#!/usr/bin/env bash
#
# secrets-sync-canary — RED/GREEN canary for deploy.sh phase 2 SECRETS SYNC.
#
# Drives the REAL phase_2_secrets_sync function (extracted from deploy.sh, so the wiring is under test,
# not a copy) against a stubbed `npx` on PATH that plays wrangler, a fake vault, and a temp checkout.
# No network, no Cloudflare, no vault.
#
# The live bug: four `wrangler … secret put failed` lines, then `[2] SECRETS SYNC ✓ PASS`. The phase
# returned 0 unconditionally. R1 is that exact state and must now exit non-zero.
#
# Usage: bash run.sh            → prints per-case results, exit 0 all-pass / 1 any-fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/../../deploy.sh"
LIB="$HERE/../../lib-secrets-sync.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

FAILS=0
ok()  { printf '  ✓ %s\n' "$1"; }
bad() { printf '  ✗ %s\n     %s\n' "$1" "$2"; FAILS=$((FAILS+1)); }

# ── fixtures ────────────────────────────────────────────────────────────────────────────────────
SRC="$WORK/src"; FW="$WORK/fw"; VAULT="$WORK/vault"; BIN="$WORK/bin"; LOG="$WORK/wrangler.log"
mkdir -p "$SRC/dashboard" "$SRC/infra/deploy" "$FW/core/scripts" "$VAULT" "$BIN"
[[ -f "$LIB" ]] && cp "$LIB" "$SRC/infra/deploy/lib-secrets-sync.sh"

# Fake vault: an alias resolves iff $VAULT/<alias> exists.
cat > "$FW/core/scripts/secrets-get.sh" <<'SH'
#!/usr/bin/env bash
alias="$1"; out="$3"
[[ -f "$VAULT/$alias" ]] || exit 1
cp "$VAULT/$alias" "$out"
SH
chmod +x "$FW/core/scripts/secrets-get.sh"

# Stub npx → wrangler. Logs argv; fails the put for any ENV in $STUB_FAIL_ENVS, echoing the value it
# was given on stderr (a worst-case wrangler) so the redaction can be checked.
cat > "$BIN/npx" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "--yes" ]] && shift
[[ "$1" == "wrangler" ]] || { echo "stub: unexpected npx target $1" >&2; exit 97; }
shift
echo "$*" >> "$WRANGLER_LOG"
val="$(cat)"
# Real wrangler in a non-interactive shell refuses without a token — phase 2 used to export none.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN" >&2; exit 1
fi
if [[ "$1 $2 $3" != "pages secret put" ]]; then
  echo "✘ [ERROR] stub: not a Pages secret write: $*" >&2; exit 2
fi
for e in $STUB_FAIL_ENVS; do
  if [[ "$4" == "$e" ]]; then
    echo "✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]" >&2
    echo "value was: $val" >&2
    exit 1
  fi
done
echo "✨ Success! Uploaded secret $4"
SH
chmod +x "$BIN/npx"

seed_vault() { rm -f "$VAULT"/*; for a in "$@"; do printf 'VALUE-OF-%s-s3cr3t' "$a" > "$VAULT/$a"; done
               printf 'acct' > "$VAULT/mbs-cloudflare-account-id"; printf 'tok' > "$VAULT/mbs-cloudflare-pages-api-token"; }
write_map()  { printf '%s\n' "$@" > "$SRC/dashboard/cloudflare-secrets.map"; }

# The real function, pulled out of deploy.sh. cf_pull_creds is its helper (absent before the fix).
extract() { awk -v f="$1" '$0 ~ "^"f"\\(\\) \\{" {p=1} p {print} p && /^}/ {exit}' "$DEPLOY"; }
FUNCS="$(extract cf_pull_creds)
$(extract phase_2_secrets_sync)"

# run_phase2 → sets RC and OUT
run_phase2() {
  : > "$LOG"
  OUT="$(
    export PATH="$BIN:$PATH" VAULT WRANGLER_LOG="$LOG" STUB_FAIL_ENVS="${STUB_FAIL_ENVS:-}"
    PAYCRAFT_SRC="$SRC" FW_ROOT="$FW" APPLY=true CF_PAGES_PROJECT=paycraft CF_WORKER_NAME=paycraft
    eval "$FUNCS"
    phase_2_secrets_sync 2>&1
  )"; RC=$?
}

MAP_OK=(
  "# comment"
  ""
  "NEXT_PUBLIC_SUPABASE_URL = framework-supabase-url"
  "SUPABASE_SERVICE_ROLE_KEY = framework-supabase-service-role-key"
  "STRIPE_CONNECT_CLIENT_ID = paycraft-stripe-connect-client-id | optional: client id is read from the DB first"
)

echo "─── RED: states where phase 2 MUST fail ────────────────────────"

write_map "${MAP_OK[@]}"; seed_vault framework-supabase-url framework-supabase-service-role-key paycraft-stripe-connect-client-id
STUB_FAIL_ENVS="NEXT_PUBLIC_SUPABASE_URL" run_phase2
[[ $RC -ne 0 ]] && ok "R1 a failed wrangler put fails the phase (was: ✗ printed, PASS reported)" \
  || bad "R1 failed put must fail the phase" "rc=$RC out: $(echo "$OUT" | tail -3)"
grep -q "Authentication error" <<<"$OUT" && ok "R1b wrangler's own error is surfaced" \
  || bad "R1b wrangler stderr must be shown" "$(echo "$OUT" | tail -3)"
grep -q "s3cr3t" <<<"$OUT" && bad "R1c secret value leaked into output" "(redacted)" \
  || ok "R1c the value is never printed, even when wrangler echoes it"

write_map "${MAP_OK[@]}"; seed_vault framework-supabase-url paycraft-stripe-connect-client-id
STUB_FAIL_ENVS="" run_phase2
[[ $RC -ne 0 ]] && ok "R2 a REQUIRED alias missing from the vault fails the phase" \
  || bad "R2 missing required alias must fail" "rc=$RC"

write_map "FOO = some-alias | maybe"; seed_vault some-alias
STUB_FAIL_ENVS="" run_phase2
[[ $RC -ne 0 ]] && ok "R3 an unrecognised qualifier is refused, not read as optional" \
  || bad "R3 bad qualifier must fail" "rc=$RC"

rm -f "$SRC/dashboard/cloudflare-secrets.map"
STUB_FAIL_ENVS="" run_phase2
[[ $RC -ne 0 ]] && ok "R4 a missing map fails (was: skipped as PASS)" || bad "R4 missing map must fail" "rc=$RC"

echo ""
echo "─── GREEN: states where phase 2 MUST pass ──────────────────────"

write_map "${MAP_OK[@]}"; seed_vault framework-supabase-url framework-supabase-service-role-key paycraft-stripe-connect-client-id
STUB_FAIL_ENVS="" run_phase2
[[ $RC -eq 0 ]] && grep -q "set: 3 · skipped(optional): 0 · failed: 0" <<<"$OUT" \
  && ok "G1 every put succeeds (vault CF token exported) → PASS" || bad "G1 all-success must pass" "rc=$RC out: $(echo "$OUT" | tail -3)"
grep -q "^pages secret put NEXT_PUBLIC_SUPABASE_URL --project-name paycraft$" "$LOG" \
  && ok "G1b the write is a PAGES secret on project 'paycraft' (not a Worker secret)" \
  || bad "G1b wrong wrangler command" "$(cat "$LOG")"

write_map "${MAP_OK[@]}"; seed_vault framework-supabase-url framework-supabase-service-role-key
STUB_FAIL_ENVS="" run_phase2
if [[ $RC -eq 0 ]] && grep -q "optional (client id is read from the DB first)" <<<"$OUT"; then
  ok "G2 a DECLARED-optional alias absent from the vault is skipped with its reason"
else
  bad "G2 declared-optional skip" "rc=$RC out: $(echo "$OUT" | tail -3)"
fi

echo ""
if [[ $FAILS -eq 0 ]]; then echo "ALL PASS"; exit 0; else echo "$FAILS FAILED"; exit 1; fi
