#!/usr/bin/env bash

# =============================================================================
# PayCraft — Setup for Verification
#
# Installs the local toolchain needed to run the verification checklist
# (docs/VERIFY_TRIAL.md). Idempotent — safe to re-run.
#
# Handles:
#   - JDK 17 (for gradle build + Kotlin unit tests)
#   - supabase CLI (for `supabase start` + migration apply)
#   - Docker Desktop (required by supabase local stack)
#   - psql (PostgreSQL client, for running server/tests/test_026_trial.sql)
#   - deno (for typechecking server/functions/*.ts)
#   - .env scaffold from .env.example (does NOT populate secrets)
#
# After this script completes successfully, you can follow docs/VERIFY_TRIAL.md.
#
# Usage:
#   ./scripts/setup-for-verify.sh              # Install missing tools
#   ./scripts/setup-for-verify.sh --check      # Report what's missing, install nothing
#   ./scripts/setup-for-verify.sh --skip-jdk   # Skip JDK (use if you manage Java elsewhere)
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'

MODE="install"
SKIP_JDK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --skip-jdk) SKIP_JDK=1; shift ;;
    -h|--help)
      sed -n '3,22p' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

OS="$(uname -s)"
if [[ "$OS" != "Darwin" ]]; then
  echo "${YELLOW}This script targets macOS (Homebrew). On Linux, install equivalents manually: openjdk-17, supabase, docker, postgresql-client, deno.${RESET}"
  exit 1
fi

# ── brew check ────────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  echo "${RED}Homebrew not found.${RESET} Install from https://brew.sh first, then re-run."
  exit 1
fi

# ── Status helpers ────────────────────────────────────────────────────────
ok()   { echo "  ${GREEN}✓${RESET} $1"; }
miss() { echo "  ${RED}✗${RESET} $1"; }
warn() { echo "  ${YELLOW}!${RESET} $1"; }
info() { echo "${CYAN}→${RESET} $1"; }

# Tracks what's missing for the summary
MISSING=()

# ── 1. JDK ────────────────────────────────────────────────────────────────
echo
info "JDK (needed by gradle)"
JDK_OK=0
if [[ $SKIP_JDK -eq 1 ]]; then
  warn "Skipped (--skip-jdk)"
  JDK_OK=1
elif command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -qE '"(17|21|22|23)\.'; then
  JDK_OK=1
  ok "$(java -version 2>&1 | head -1)"
elif [[ -d /opt/homebrew/opt/openjdk@17 ]] || [[ -d /usr/local/opt/openjdk@17 ]]; then
  warn "openjdk@17 installed but not on PATH. Add to your shell rc:"
  echo "    export PATH=\"\$(brew --prefix openjdk@17)/bin:\$PATH\""
  echo "    export JAVA_HOME=\"\$(brew --prefix openjdk@17)\""
  MISSING+=("jdk-path")
else
  miss "JDK 17+ not found"
  if [[ "$MODE" == "install" ]]; then
    info "Installing openjdk@17 via brew..."
    brew install openjdk@17
    warn "After install, add to your shell rc:"
    echo "    export PATH=\"\$(brew --prefix openjdk@17)/bin:\$PATH\""
    echo "    export JAVA_HOME=\"\$(brew --prefix openjdk@17)\""
    MISSING+=("jdk-path")
  else
    MISSING+=("jdk")
  fi
fi

# ── 2. supabase CLI ───────────────────────────────────────────────────────
echo
info "supabase CLI (needed for local stack + migrations)"
if command -v supabase >/dev/null 2>&1; then
  ok "$(supabase --version 2>&1)"
else
  miss "supabase CLI not found"
  if [[ "$MODE" == "install" ]]; then
    info "Installing supabase via brew tap..."
    brew install supabase/tap/supabase
    ok "Installed"
  else
    MISSING+=("supabase")
  fi
fi

# ── 3. Docker (needed by supabase) ────────────────────────────────────────
echo
info "Docker (required by supabase local stack)"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker is running"
elif command -v docker >/dev/null 2>&1; then
  warn "Docker installed but not running. Start Docker Desktop manually."
  MISSING+=("docker-not-running")
else
  miss "Docker not found"
  warn "Install Docker Desktop manually: https://www.docker.com/products/docker-desktop"
  warn "(brew cask is no longer supported — desktop install required.)"
  MISSING+=("docker")
fi

# ── 4. psql ───────────────────────────────────────────────────────────────
echo
info "psql (PostgreSQL client — for running server/tests/test_026_trial.sql)"
if command -v psql >/dev/null 2>&1; then
  ok "$(psql --version)"
else
  miss "psql not found"
  if [[ "$MODE" == "install" ]]; then
    info "Installing libpq via brew (provides psql)..."
    brew install libpq
    warn "After install, add psql to PATH:"
    echo "    export PATH=\"\$(brew --prefix libpq)/bin:\$PATH\""
    MISSING+=("psql-path")
  else
    MISSING+=("psql")
  fi
fi

# ── 5. deno ───────────────────────────────────────────────────────────────
echo
info "deno (for typechecking server/functions/*.ts)"
if command -v deno >/dev/null 2>&1; then
  ok "$(deno --version | head -1)"
else
  miss "deno not found"
  if [[ "$MODE" == "install" ]]; then
    info "Installing deno via brew..."
    brew install deno
    ok "Installed"
  else
    MISSING+=("deno")
  fi
fi

# ── 6. .env scaffold ──────────────────────────────────────────────────────
echo
info ".env scaffold"
if [[ -f .env ]]; then
  ok ".env already exists (not overwriting)"
elif [[ "$MODE" == "check" ]]; then
  miss ".env missing (run without --check to scaffold from .env.example)"
  MISSING+=("env-file")
elif [[ -f .env.example ]]; then
  cp .env.example .env
  warn ".env created from .env.example — populate the following before /paycraft-adopt-verify:"
  echo "    PAYCRAFT_SUPABASE_URL           (from supabase start output)"
  echo "    PAYCRAFT_SUPABASE_ANON_KEY      (from supabase start output)"
  echo "    PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY  (from supabase start output)"
  echo "    PAYCRAFT_SUPABASE_PROJECT_REF   (your hosted project; leave blank for local-only)"
  echo "    PAYCRAFT_SUPABASE_ACCESS_TOKEN  (from https://supabase.com/dashboard/account/tokens)"
  echo "    PAYCRAFT_STRIPE_TEST_SECRET_KEY (sk_test_... from https://dashboard.stripe.com/test/apikeys)"
  echo "    PAYCRAFT_PROVIDER=stripe"
  echo "    PAYCRAFT_PLAN_COUNT             (e.g. 3 for monthly/quarterly/yearly)"
  echo "    PAYCRAFT_PLAN_1_ID, PAYCRAFT_PLAN_1_NAME, PAYCRAFT_PLAN_1_PRICE, PAYCRAFT_PLAN_1_INTERVAL, PAYCRAFT_PLAN_1_TRIAL_DAYS"
  echo "    ... (repeat per plan)"
else
  warn ".env.example missing — cannot scaffold"
fi

# ── 7. Summary ────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────────────────────"
if [[ ${#MISSING[@]} -eq 0 ]]; then
  echo "${GREEN}Toolchain ready. Next: follow docs/VERIFY_TRIAL.md${RESET}"
  exit 0
fi

echo "${YELLOW}Setup incomplete — manual steps remaining:${RESET}"
for m in "${MISSING[@]}"; do
  case "$m" in
    jdk)              echo "  - Install JDK 17:        brew install openjdk@17" ;;
    jdk-path)         echo "  - Add JDK to PATH:       (instructions above)" ;;
    supabase)         echo "  - Install supabase CLI:  brew install supabase/tap/supabase" ;;
    docker)           echo "  - Install Docker:        https://www.docker.com/products/docker-desktop" ;;
    docker-not-running) echo "  - Start Docker Desktop:  open -a Docker (then wait for daemon)" ;;
    psql)             echo "  - Install psql:          brew install libpq" ;;
    psql-path)        echo "  - Add psql to PATH:      (instructions above)" ;;
    deno)             echo "  - Install deno:          brew install deno" ;;
    env-file)         echo "  - Scaffold .env:         re-run without --check" ;;
  esac
done

echo
echo "After resolving the items above, re-run:  ./scripts/setup-for-verify.sh --check"
exit 1
