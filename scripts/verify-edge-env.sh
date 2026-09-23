#!/usr/bin/env bash
# =============================================================================
# verify-edge-env.sh — every env var an edge function READS must exist on the project
# =============================================================================
# Catches the defect class that took PayCraft Cloud billing down silently:
#
#   cloud-billing-webhook read  PAYCRAFT_CLOUD_STRIPE_SECRET_KEY
#   the Supabase project had    PAYCRAFT_STRIPE_LIVE_SECRET_KEY
#
# Same secret, two names, because two command runtimes provisioned the SAME store differently
# (paycraft-adopt-cloud.md vs paycraft-adopt-keys.md). Production followed one; the code was written
# against the other. Every event returned 500, Stripe retried and then gave up, and a tenant's plan
# change was lost with nothing to show for it — a 500 reads like a transient blip.
#
# Nothing could have caught this:
#   • deno check passes — the name is a string, not a symbol
#   • the smoke test passes — it asserts reachability, and a 500 IS reachable
#   • the function deploys fine — the miss only appears at runtime, on a real event
#
# So the check has to compare the two sides directly: what the CODE reads vs what the PROJECT has.
#
# Usage:
#   bash scripts/verify-edge-env.sh                # all functions
#   bash scripts/verify-edge-env.sh cloud-billing-webhook
#
# Exit 0 = every read name is satisfied. Exit 1 = at least one function reads a name nothing sets.
# =============================================================================
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
FW_ROOT="${FW_ROOT:-$(cd ../../../../.. 2>/dev/null && pwd)}"
ONLY="${1:-}"

if [ -n "${GITHUB_ACTIONS:-}" ]; then err() { echo "::error::$*"; }; else err() { echo "❌ $*"; }; fi

# ── what the PROJECT has ─────────────────────────────────────────────────────
SECRETS="$(bash "$FW_ROOT/core/scripts/supabase-connect.sh" mgmt GET \
  "projects/$(tr -d '[:space:]' < supabase/.temp/project-ref)/secrets" \
  --target mbs/PayCraft 2>/dev/null | grep -o '"name":"[A-Z_]*"' | sed 's/"name":"//;s/"//')"

if [ -z "$SECRETS" ]; then
  err "could not list project secrets — is the Supabase account PAT resolvable?"
  exit 1
fi
echo "project has $(printf '%s\n' "$SECRETS" | wc -l | tr -d ' ') secret(s)"

# Supabase injects these into every function; they are never in the secrets list.
BUILTIN="SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL"

fail=0
for d in supabase/functions/*/; do
  fn="$(basename "$d")"
  [ -f "${d}index.ts" ] || continue
  [ -n "$ONLY" ] && [ "$fn" != "$ONLY" ] && continue

  # Names read by the function AND by the _shared modules it ACTUALLY IMPORTS.
  #
  # Following imports matters more than it looks. A first cut concatenated every _shared/*.ts into
  # every function, which made all 25 inherit GOOGLE_PLAY_SA_JSON, APPLE_ROOT_CA_EXTRA_FINGERPRINTS
  # and PAYCRAFT_FROM_EMAIL — every function flagged, every run noisy, and the one real finding
  # buried. A gate nobody can act on gets muted, which is worse than no gate.
  srcs="${d}index.ts"
  while read -r mod; do
    [ -n "$mod" ] || continue
    f="supabase/functions/_shared/${mod}"
    [ -f "$f" ] && srcs="$srcs $f"
  done < <(grep -oE 'from "\.\./_shared/[A-Za-z0-9._-]+"' "${d}index.ts" 2>/dev/null \
           | sed 's|.*/_shared/||; s|"$||' | sort -u)

  # One level deeper: a _shared module may pull another (e.g. a webhook helper importing play-jwt).
  for f in $srcs; do
    while read -r mod; do
      [ -n "$mod" ] || continue
      g="supabase/functions/_shared/${mod}"
      [ -f "$g" ] && case " $srcs " in *" $g "*) :;; *) srcs="$srcs $g";; esac
    done < <(grep -oE 'from "\./[A-Za-z0-9._-]+"' "$f" 2>/dev/null | sed 's|.*/\./||; s|"$||' | sort -u)
  done

  reads="$(cat $srcs 2>/dev/null \
            | grep -oE 'Deno\.env\.get\("[A-Z_][A-Z0-9_]*"\)' \
            | grep -oE '"[A-Z_][A-Z0-9_]*"' | tr -d '"' | sort -u)"

  missing=""
  for name in $reads; do
    case " $BUILTIN " in *" $name "*) continue ;; esac
    printf '%s\n' "$SECRETS" | grep -qx "$name" && continue

    # SATISFIED BY A FALLBACK CHAIN?
    #
    # The house convention is `get("X_LIVE_SECRET") ?? get("X_SECRET") ?? ""` — the split name is
    # absent by design and the unsplit one carries it. stripe-webhook and razorpay-webhook both do
    # this, and flagging them would be a false positive on the codebase's own idiom.
    #
    # cloud-billing-webhook is precisely the function that did NOT follow it: it read one name, with
    # no alternative, so an absent name meant a dead endpoint. That asymmetry is what this check
    # encodes — a name alone is a gap, a name in a chain with something set is fine.
    # Flatten each source and look for the missing name and a SET name inside one statement. The
    # chains wrap across lines, so a line-oriented window kept missing them; a flattened scan
    # bounded by `;` is both simpler and correct.
    if SET_NAMES="$SECRETS" python3 - "$name" $srcs <<'PY'
import os, re, sys
name = sys.argv[1]
have = set(os.environ["SET_NAMES"].split())
for path in sys.argv[2:]:
    try: src = open(path).read()
    except OSError: continue
    for stmt in src.split(";"):
        if f'"{name}"' not in stmt:
            continue
        if any(f'"{s}"' in stmt for s in have):
            sys.exit(0)          # same chain carries a name that IS set
sys.exit(1)
PY
    then
      continue
    fi

    # EXPLICIT WAIVER — `// env-optional: NAME — reason`
    #
    # Some fallbacks are real but not visible to a statement-scoped scan: stripe-webhook declares
    # `envLiveSecretKey` with no `||`, then falls back at the USE site
    # (`isLive ? envLiveSecretKey || envTestSecretKey : ...`). Following that would mean
    # cross-statement dataflow analysis in bash, which is not worth building and would still miss
    # cases. A one-line annotation states the intent where a reader will see it, and keeps the gate
    # quiet about names that are absent on purpose. Anything NOT waived and NOT chained is a gap.
    if grep -qE "env-optional:[[:space:]]*${name}\b" $srcs 2>/dev/null; then
      continue
    fi
    missing="$missing $name"
  done

  if [ -n "$missing" ]; then
    # Not every miss is a bug: a var with a documented fallback (a per-tenant credential, a default)
    # is legitimately absent. The gate REPORTS rather than assumes, because the two are
    # indistinguishable from the outside — and an unreported miss is what this exists to prevent.
    echo "  ⚠ ${fn}: reads unset →$missing"
    fail=1
  fi
done

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✅ verify-edge-env: every env var read by an edge function is set on the project"
else
  echo "⚠ verify-edge-env: names above are read in code but absent from the project."
  echo "   Each is either (a) a genuine provisioning gap — set it, or"
  echo "                  (b) an intentional fallback — document it in the function's header."
fi
exit $fail
