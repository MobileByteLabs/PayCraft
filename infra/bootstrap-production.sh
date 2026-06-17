#!/usr/bin/env bash
# bootstrap-production.sh — PayCraft v2.0 prod bootstrap helper
#
# Idempotent: safe to re-run. Each step checks current state and skips if
# already done. State is tracked in `_paycraft_bootstrap.state` at the project
# root (one `STEP_NAME=ok at=<ISO>` line per completed step).
#
# Companion to docs/PRODUCTION_LAUNCH_RUNBOOK.md.
#
# This script does NOT generate credentials. The human creates them at
# Stripe / Razorpay / Cloudflare / Postmark / Sentry, pushes them to the
# vault via `/secrets push <alias>`, and then re-runs this script which
# picks them up via `bash core/scripts/secrets-get.sh <alias>`.
#
# Hard rules (RULE-SECRETS-VAULT-001):
#   - Secret values are NEVER echoed, never assigned to top-level variables,
#     never tee'd to stdout. They flow through subshells into the consumer
#     tool (`supabase secrets set`, `vercel env add`) and die there.
#   - This script NEVER calls `gh secret set` on a consumer repo. CI secrets
#     are provisioned by `/secrets sync-to-ci`.
#
# Usage:
#   ./bootstrap-production.sh                  # dry-run (default)
#   ./bootstrap-production.sh --apply          # actually mutate
#   ./bootstrap-production.sh --apply --from-step 5
#   ./bootstrap-production.sh --apply --skip-vercel --skip-cloudflare

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# CLI flags
# ──────────────────────────────────────────────────────────────────────────────

APPLY=0
SKIP_VERCEL=0
SKIP_CLOUDFLARE=0
SKIP_MAVEN=0
FROM_STEP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)           APPLY=1; shift ;;
    --dry-run)         APPLY=0; shift ;;
    --skip-vercel)     SKIP_VERCEL=1; shift ;;
    --skip-cloudflare) SKIP_CLOUDFLARE=1; shift ;;
    --skip-maven)      SKIP_MAVEN=1; shift ;;
    --from-step)       FROM_STEP="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

# ──────────────────────────────────────────────────────────────────────────────
# Paths + state file
# ──────────────────────────────────────────────────────────────────────────────

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${HERE}/.." && pwd)"  # .../source/PayCraft
STATE_FILE="${PROJECT_ROOT}/_paycraft_bootstrap.state"

# Auto-detect framework root by walking up from PROJECT_ROOT
_detect_framework_root() {
  local d="${PAYCRAFT_FRAMEWORK_ROOT:-}"
  if [[ -n "$d" && -d "$d/core/scripts" ]]; then
    echo "$d"; return 0
  fi
  d="$PROJECT_ROOT"
  while [[ "$d" != "/" ]]; do
    if [[ -d "$d/core/scripts" && -f "$d/core/scripts/secrets-get.sh" ]]; then
      echo "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}
PAYCRAFT_FRAMEWORK_ROOT="$(_detect_framework_root || true)"

SECRETS_GET=""
if [[ -n "${PAYCRAFT_FRAMEWORK_ROOT:-}" ]]; then
  SECRETS_GET="${PAYCRAFT_FRAMEWORK_ROOT}/core/scripts/secrets-get.sh"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Logging helpers
# ──────────────────────────────────────────────────────────────────────────────

_ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()      { printf "[%s] %s\n" "$(_ts)" "$*"; }
info()     { log "INFO  $*"; }
warn()     { log "WARN  $*" >&2; }
err()      { log "ERROR $*" >&2; }
section()  { printf "\n══ %s ══\n" "$*"; }

mode_banner() {
  if [[ "$APPLY" -eq 1 ]]; then
    section "MODE: --apply (mutating)"
  else
    section "MODE: --dry-run (no mutations — pass --apply to execute)"
  fi
}

# Resolve a secret alias to a value WITHOUT echoing it.
# Usage: secret_into_cmd <alias> -- <command> <args...>
#   The resolved value is piped to <command> on stdin OR substituted via
#   <command> consuming the secret from its own stdin. NEVER assign the
#   result to a shell variable that gets logged.
require_secrets_get() {
  if [[ -z "$SECRETS_GET" || ! -x "$SECRETS_GET" ]]; then
    err "secrets-get.sh not found. Set PAYCRAFT_FRAMEWORK_ROOT to the framework checkout."
    err "Expected: <framework-root>/core/scripts/secrets-get.sh"
    exit 3
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# State-file helpers (idempotency ledger)
# ──────────────────────────────────────────────────────────────────────────────

state_mark_ok() {
  local step="$1"
  touch "$STATE_FILE"
  # Replace any prior line for this step, then append the fresh one.
  if grep -q "^${step}=" "$STATE_FILE" 2>/dev/null; then
    grep -v "^${step}=" "$STATE_FILE" > "${STATE_FILE}.tmp" || true
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
  echo "${step}=ok at=$(_ts)" >> "$STATE_FILE"
}

state_is_ok() {
  local step="$1"
  [[ -f "$STATE_FILE" ]] && grep -q "^${step}=ok" "$STATE_FILE"
}

run_step() {
  local n="$1"; local name="$2"; local fn="$3"
  if [[ "$n" -lt "$FROM_STEP" ]]; then
    info "step $n ($name): SKIP (--from-step $FROM_STEP)"
    return 0
  fi
  if state_is_ok "$name"; then
    info "step $n ($name): SKIP (already ok in state file)"
    return 0
  fi
  section "STEP $n: $name"
  if "$fn"; then
    state_mark_ok "$name"
    info "step $n ($name): OK"
  else
    local rc=$?
    err "step $n ($name): FAILED (exit $rc)"
    err "After fixing externally, manually flip the state file:"
    err "  echo '${name}=ok at=$(_ts)' >> ${STATE_FILE}"
    exit "$rc"
  fi
}

# Helper: announce a mutation. Returns 0 if we should run it, 1 in dry-run.
will_mutate() {
  local what="$1"
  if [[ "$APPLY" -eq 1 ]]; then
    info "  EXEC: $what"
    return 0
  else
    info "  DRY:  $what"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Required env vars + defaults
# ──────────────────────────────────────────────────────────────────────────────

: "${PAYCRAFT_SUPABASE_REGION:=us-east-1}"
: "${PAYCRAFT_DOMAIN:=paycraft.mobilebytesensei.com}"

validate_env() {
  local missing=()
  [[ -z "${PAYCRAFT_SUPABASE_ORG_ID:-}" ]] && missing+=("PAYCRAFT_SUPABASE_ORG_ID")
  if [[ -z "${PAYCRAFT_FRAMEWORK_ROOT:-}" ]]; then
    missing+=("PAYCRAFT_FRAMEWORK_ROOT (auto-detect failed)")
  fi
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required env vars:"
    for v in "${missing[@]}"; do err "  - $v"; done
    err ""
    err "Example invocation:"
    err "  PAYCRAFT_SUPABASE_ORG_ID=org_xxxx \\"
    err "  PAYCRAFT_SUPABASE_REGION=us-east-1 \\"
    err "  PAYCRAFT_DOMAIN=paycraft.mobilebytesensei.com \\"
    err "  ./bootstrap-production.sh --apply"
    exit 4
  fi
  info "env: org=${PAYCRAFT_SUPABASE_ORG_ID} region=${PAYCRAFT_SUPABASE_REGION} domain=${PAYCRAFT_DOMAIN}"
  info "env: framework_root=${PAYCRAFT_FRAMEWORK_ROOT}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Tooling preflight
# ──────────────────────────────────────────────────────────────────────────────

# Minimum versions (loose check via lexicographic compare on first numeric token)
_version_ok() {
  local have="$1" want="$2"
  # strip leading non-digits
  have="$(echo "$have" | grep -oE '[0-9]+(\.[0-9]+){0,2}' | head -n1)"
  [[ -z "$have" ]] && return 1
  # use sort -V
  printf '%s\n%s\n' "$want" "$have" | sort -V -C 2>/dev/null
}

require_tool() {
  local bin="$1" min="$2" version_cmd="$3"
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "  MISSING: $bin (need >= $min)"
    return 1
  fi
  local v
  v="$(eval "$version_cmd" 2>/dev/null || true)"
  if ! _version_ok "$v" "$min"; then
    warn "  $bin present but version check inconclusive (have='$v', want>=$min) — continuing"
  else
    info "  OK: $bin (>= $min)"
  fi
  return 0
}

check_tools() {
  local rc=0
  require_tool supabase  1.0.0  "supabase --version"            || rc=1
  require_tool vercel    30.0.0 "vercel --version"              || rc=1
  require_tool terraform 1.6.0  "terraform version | head -n1"  || rc=1
  require_tool gh        2.0.0  "gh --version | head -n1"       || rc=1
  require_tool psql      0      "psql --version"                || rc=1
  require_tool jq        0      "jq --version"                  || rc=1
  if [[ $rc -ne 0 ]]; then
    err "Install missing tooling and re-run."
    err "  brew install supabase/tap/supabase vercel terraform gh postgresql jq"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 1 — preflight
# ──────────────────────────────────────────────────────────────────────────────

step_1_preflight_checks() {
  validate_env
  check_tools || return 1
  require_secrets_get

  # Git status — must be clean
  if ! git -C "$PROJECT_ROOT" diff --quiet || ! git -C "$PROJECT_ROOT" diff --cached --quiet; then
    warn "Working tree has uncommitted changes."
    warn "Prod bootstrap should run from a clean tree; commit or stash first."
    if [[ "$APPLY" -eq 1 ]]; then
      err "Refusing to --apply with dirty tree."
      return 1
    fi
  fi

  local branch
  branch="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)"
  info "  git branch: ${branch}"

  # Prod env files present? (Supabase config + Vercel project hint)
  local req=(
    "${PROJECT_ROOT}/supabase/config.toml"
    "${PROJECT_ROOT}/supabase/migrations"
  )
  for f in "${req[@]}"; do
    if [[ ! -e "$f" ]]; then
      err "  MISSING: $f"
      return 1
    fi
    info "  OK: $f"
  done
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 2 — Supabase login check
# ──────────────────────────────────────────────────────────────────────────────

step_2_supabase_login_check() {
  if supabase projects list >/dev/null 2>&1; then
    info "  supabase CLI authenticated"
  else
    err "  supabase CLI not authenticated."
    err "  Run: supabase login"
    err "  Then re-run this script."
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 3 — create or link Supabase project
# ──────────────────────────────────────────────────────────────────────────────

_secret_exists() {
  local alias="$1"
  "$SECRETS_GET" "$alias" >/dev/null 2>&1
}

step_3_supabase_create_or_link_project() {
  local ref_alias="mbs-paycraft-supabase-prod-ref"
  local ref

  if _secret_exists "$ref_alias"; then
    info "  vault has ${ref_alias}; linking…"
    if will_mutate "supabase link --project-ref \$(secrets-get ${ref_alias})"; then
      # Subshell — the ref is short-lived; project refs are not secrets per se
      # but we still keep them out of the parent process's env.
      ( ref="$("$SECRETS_GET" "$ref_alias")" && \
        supabase link --project-ref "$ref" )
    fi
  else
    info "  no vault entry for ${ref_alias}; creating new prod project…"
    if will_mutate "supabase projects create paycraft-prod --org-id ${PAYCRAFT_SUPABASE_ORG_ID} --region ${PAYCRAFT_SUPABASE_REGION}"; then
      local out
      out="$(supabase projects create paycraft-prod \
        --org-id "$PAYCRAFT_SUPABASE_ORG_ID" \
        --region "$PAYCRAFT_SUPABASE_REGION" \
        --output json)"
      ref="$(echo "$out" | jq -r '.id // .ref // empty')"
      if [[ -z "$ref" ]]; then
        err "  Failed to parse project ref from supabase output."
        err "  Raw: $out"
        return 1
      fi
      info "  created project ref=${ref}"
      # Push to vault (value piped, never logged)
      info "  pushing ref to vault as ${ref_alias}"
      echo "$ref" | "${PAYCRAFT_FRAMEWORK_ROOT}/core/scripts/secrets-push.sh" --stdin --alias "$ref_alias"
      # Link
      supabase link --project-ref "$ref"
      # Write to PROJECT_CONFIG.yaml — non-secret field
      local pc="${PROJECT_ROOT}/PROJECT_CONFIG.yaml"
      if [[ -f "$pc" ]]; then
        if grep -q "supabase_project_ref" "$pc"; then
          warn "  PROJECT_CONFIG.yaml already declares supabase_project_ref — leaving as-is."
        else
          info "  appending production.supabase_project_ref=${ref} to PROJECT_CONFIG.yaml"
          {
            echo ""
            echo "# Appended by bootstrap-production.sh on $(_ts)"
            echo "backend:"
            echo "  environments:"
            echo "    production:"
            echo "      supabase_project_ref: ${ref}"
          } >> "$pc"
        fi
      fi
    fi
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 4 — push migrations
# ──────────────────────────────────────────────────────────────────────────────

step_4_supabase_push_migrations() {
  info "  dry-run first…"
  ( cd "$PROJECT_ROOT" && supabase db push --linked --dry-run )
  if will_mutate "supabase db push --linked"; then
    printf "  Review the dry-run above. Press ENTER to apply, Ctrl-C to abort: "
    read -r _
    ( cd "$PROJECT_ROOT" && supabase db push --linked )
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 5 — deploy edge functions
# ──────────────────────────────────────────────────────────────────────────────

step_5_supabase_push_edge_functions() {
  local fn_dir="${PROJECT_ROOT}/supabase/functions"
  if [[ ! -d "$fn_dir" ]]; then
    info "  no supabase/functions/ directory — skipping"
    return 0
  fi
  local fns=()
  for d in "$fn_dir"/*/; do
    [[ -d "$d" ]] || continue
    local name
    name="$(basename "$d")"
    # Skip shared helpers
    [[ "$name" == _* ]] && continue
    fns+=("$name")
  done
  if [[ ${#fns[@]} -eq 0 ]]; then
    info "  no functions to deploy"
    return 0
  fi
  for fn in "${fns[@]}"; do
    if will_mutate "supabase functions deploy ${fn} --linked"; then
      ( cd "$PROJECT_ROOT" && supabase functions deploy "$fn" --linked )
    fi
  done
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 6 — Supabase secrets (Edge Function env)
# ──────────────────────────────────────────────────────────────────────────────

# alias_to_keyname:  vault alias  ->  KEY=  name Supabase expects
declare -a SUPABASE_SECRETS=(
  "mbs-paycraft-stripe-live-sk:STRIPE_SECRET_KEY"
  "mbs-paycraft-razorpay-live-secret:RAZORPAY_KEY_SECRET"
  "mbs-paycraft-postmark-token:POSTMARK_SERVER_TOKEN"
  "mbs-paycraft-sentry-dsn:SENTRY_DSN"
)

step_6_supabase_set_secrets() {
  for pair in "${SUPABASE_SECRETS[@]}"; do
    local alias="${pair%%:*}"
    local key="${pair##*:}"
    if ! _secret_exists "$alias"; then
      warn "  vault missing alias ${alias} — skipping ${key}. Push via:"
      warn "    /secrets push ${alias}"
      continue
    fi
    if will_mutate "supabase secrets set --linked ${key}=<from vault:${alias}>"; then
      # Value resolved inside subshell, consumed by supabase directly,
      # never assigned to a parent-scope variable.
      ( supabase secrets set --linked \
          "${key}=$("$SECRETS_GET" "$alias")" >/dev/null )
      info "  set ${key} (value from vault, not logged)"
    fi
  done
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 7 — Vercel login check
# ──────────────────────────────────────────────────────────────────────────────

step_7_vercel_login_check() {
  if [[ "$SKIP_VERCEL" -eq 1 ]]; then
    info "  --skip-vercel; bypassing"
    return 0
  fi
  if vercel whoami >/dev/null 2>&1; then
    info "  vercel CLI authenticated as: $(vercel whoami 2>/dev/null)"
  else
    err "  vercel CLI not authenticated."
    err "  Run: vercel login"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 8 — link Vercel project
# ──────────────────────────────────────────────────────────────────────────────

step_8_vercel_link_project() {
  if [[ "$SKIP_VERCEL" -eq 1 ]]; then info "  --skip-vercel; bypassing"; return 0; fi
  local dash_dir="${PROJECT_ROOT}/dashboard"
  [[ -d "$dash_dir" ]] || dash_dir="$PROJECT_ROOT"
  if [[ -f "${dash_dir}/.vercel/project.json" ]]; then
    info "  vercel project already linked at ${dash_dir}/.vercel/"
    return 0
  fi
  if will_mutate "(cd ${dash_dir} && vercel link --project paycraft-dashboard --yes)"; then
    ( cd "$dash_dir" && vercel link --project paycraft-dashboard --yes )
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 9 — Vercel env vars
# ──────────────────────────────────────────────────────────────────────────────

# alias -> VERCEL_ENV_NAME
declare -a VERCEL_ENV_VARS=(
  "mbs-paycraft-supabase-prod-url:NEXT_PUBLIC_SUPABASE_URL"
  "mbs-paycraft-supabase-prod-anon-key:NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "mbs-paycraft-supabase-prod-service-role:SUPABASE_SERVICE_ROLE_KEY"
  "mbs-paycraft-stripe-live-pk:NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  "mbs-paycraft-stripe-live-sk:STRIPE_SECRET_KEY"
  "mbs-paycraft-razorpay-live-key:NEXT_PUBLIC_RAZORPAY_KEY_ID"
  "mbs-paycraft-razorpay-live-secret:RAZORPAY_KEY_SECRET"
  "mbs-paycraft-postmark-token:POSTMARK_SERVER_TOKEN"
  "mbs-paycraft-sentry-dsn:NEXT_PUBLIC_SENTRY_DSN"
)

step_9_vercel_set_env_vars() {
  if [[ "$SKIP_VERCEL" -eq 1 ]]; then info "  --skip-vercel; bypassing"; return 0; fi
  local dash_dir="${PROJECT_ROOT}/dashboard"
  [[ -d "$dash_dir" ]] || dash_dir="$PROJECT_ROOT"
  for pair in "${VERCEL_ENV_VARS[@]}"; do
    local alias="${pair%%:*}"
    local name="${pair##*:}"
    if ! _secret_exists "$alias"; then
      warn "  vault missing alias ${alias} — skipping ${name}. Push via:"
      warn "    /secrets push ${alias}"
      continue
    fi
    if will_mutate "vercel env add ${name} production --force  <from vault:${alias}>"; then
      # Pipe in subshell — value never reaches parent env or logs.
      ( cd "$dash_dir" && \
        "$SECRETS_GET" "$alias" | vercel env add "$name" production --force >/dev/null )
      info "  set vercel env ${name}=<from vault, not logged>"
    fi
  done
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 10 — Cloudflare via Terraform
# ──────────────────────────────────────────────────────────────────────────────

step_10_cloudflare_terraform_apply() {
  if [[ "$SKIP_CLOUDFLARE" -eq 1 ]]; then
    info "  --skip-cloudflare; bypassing"
    return 0
  fi
  local tf_dir="${PROJECT_ROOT}/infra/dns"
  if [[ ! -d "$tf_dir" ]]; then
    warn "  ${tf_dir} not found — skipping Cloudflare apply"
    return 0
  fi
  local cf_alias="mbs-cloudflare-api-token"
  if ! _secret_exists "$cf_alias"; then
    err "  vault missing ${cf_alias}. Push via:"
    err "    /secrets push ${cf_alias}"
    return 1
  fi

  if will_mutate "terraform init && terraform plan -out=tfplan && terraform apply tfplan"; then
    ( cd "$tf_dir" && terraform init -input=false )
    # Pass token via TF_VAR_* env var, scoped to subshell.
    ( cd "$tf_dir" && \
      TF_VAR_cloudflare_api_token="$("$SECRETS_GET" "$cf_alias")" \
        terraform plan -out=tfplan -input=false )
    printf "  Review plan above. Press ENTER to apply, Ctrl-C to abort: "
    read -r _
    ( cd "$tf_dir" && \
      TF_VAR_cloudflare_api_token="$("$SECRETS_GET" "$cf_alias")" \
        terraform apply -input=false tfplan )
  else
    ( cd "$tf_dir" && terraform init -input=false -backend=false >/dev/null 2>&1 || true )
    info "  dry-run: would run terraform plan + apply in ${tf_dir}"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 11 — post-bootstrap smoke check
# ──────────────────────────────────────────────────────────────────────────────

step_11_post_bootstrap_verify() {
  local base="https://${PAYCRAFT_DOMAIN}"
  local probe1="${base}/api/health"
  local probe2="${base}/"
  local code
  if code="$(curl -fsS -o /dev/null -w '%{http_code}' "$probe1" 2>/dev/null)"; then
    info "  ${probe1} → HTTP ${code} ✓"
  elif code="$(curl -fsS -o /dev/null -w '%{http_code}' "$probe2" 2>/dev/null)"; then
    warn "  ${probe1} unreachable; ${probe2} → HTTP ${code} (no /api/health endpoint deployed?)"
  else
    warn "  ${base} unreachable — DNS may still be propagating (TTL up to 5 min on Cloudflare)"
    warn "  Retry: curl -v ${probe1}"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 12 — summary
# ──────────────────────────────────────────────────────────────────────────────

step_12_summary() {
  local ref=""
  if _secret_exists "mbs-paycraft-supabase-prod-ref"; then
    ref="$("$SECRETS_GET" "mbs-paycraft-supabase-prod-ref" 2>/dev/null || echo '<unset>')"
  fi
  cat <<EOF

═════════════════════════════════════════════════════════════════════════════
  PayCraft v2.0 production bootstrap — SUMMARY
═════════════════════════════════════════════════════════════════════════════

  Supabase
    project ref:    ${ref:-<not in vault>}
    dashboard:      https://supabase.com/dashboard/project/${ref:-<ref>}
    api url:        https://${ref:-<ref>}.supabase.co
    migrations:     applied via 'supabase db push --linked'
    edge functions: deployed from supabase/functions/

  Vercel
    project:        paycraft-dashboard
    url:            https://${PAYCRAFT_DOMAIN}
    env vars:       $(( ${#VERCEL_ENV_VARS[@]} )) production values set from vault

  Cloudflare
    domain:         ${PAYCRAFT_DOMAIN}
    dns:            applied via infra/dns/ terraform module

  Maven Central
EOF
  if [[ "$SKIP_MAVEN" -eq 1 ]]; then
    echo "    SKIPPED (--skip-maven)"
  else
    cat <<EOF
    Next step (human-driven):
      git tag v2.0.0
      git push --tags
    This triggers .github/workflows/publish.yml which signs + publishes
    cmp-paycraft to Maven Central (~30 min visibility).
EOF
  fi
  cat <<EOF

  State file:       ${STATE_FILE}
                    (delete to force full re-run; edit lines to re-run one step)

═════════════════════════════════════════════════════════════════════════════
EOF
}

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

main() {
  mode_banner

  run_step  1 preflight_checks              step_1_preflight_checks
  run_step  2 supabase_login_check          step_2_supabase_login_check
  run_step  3 supabase_create_or_link       step_3_supabase_create_or_link_project
  run_step  4 supabase_push_migrations      step_4_supabase_push_migrations
  run_step  5 supabase_push_edge_functions  step_5_supabase_push_edge_functions
  run_step  6 supabase_set_secrets          step_6_supabase_set_secrets
  run_step  7 vercel_login_check            step_7_vercel_login_check
  run_step  8 vercel_link_project           step_8_vercel_link_project
  run_step  9 vercel_set_env_vars           step_9_vercel_set_env_vars
  run_step 10 cloudflare_terraform_apply    step_10_cloudflare_terraform_apply
  run_step 11 post_bootstrap_verify         step_11_post_bootstrap_verify
  run_step 12 summary                       step_12_summary

  if [[ "$APPLY" -eq 0 ]]; then
    section "DRY-RUN COMPLETE — re-run with --apply to execute mutations."
  else
    section "BOOTSTRAP COMPLETE"
  fi
}

main "$@"
