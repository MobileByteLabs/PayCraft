#!/usr/bin/env bash
# infra/attempt-cron-check.sh — the 4 pg_cron schedules paycraft-attempt-observability needs (GOAL AC-8)
# are all registered by a migration:
#   paycraft_attempt_alerts_digest  hourly digest of non-critical attempt alerts      (attempt-alerts)
#   paycraft_attempt_stitch         every 5 min: stitch + paid_not_granted + criticals (attempt-stitch)
#   paycraft_tenant_alerts          hourly legacy owner alerts                          (tenant-alerts)
#   paycraft_attempt_insights       weekly insights dispatcher                          (attempt_insights_dispatch)
# A schedule only counts as a live `cron.schedule('<name>'` call — a commented-out line (`-- …`) does not.
#
# The weekly insights job must also DO something (sub-plan 06, AC-18): 211 registered it against a no-op
# attempt_insights_dispatch(), and 212 replaces that body with the call to the attempt-insights edge function. So:
#   · the LAST migration (in apply order) that defines public.attempt_insights_dispatch() must call
#     paycraft_function_post('attempt-insights') in a live line of its body — a dispatcher left as the stub, or
#     with the call commented out, fails;
#   · exactly ONE live schedule may name an insights job — a second weekly schedule (e.g. a hand-added
#     'attempt-insights-weekly') would summarise and bill every tenant twice.
#
# Usage: infra/attempt-cron-check.sh [--migrations <dir>]   (default supabase/migrations)
# Exit 0 PASS · 1 a schedule is missing (each one named) · 2 usage error. Reads files only, never Postgres.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="supabase/migrations"
if [[ "${1:-}" == "--migrations" ]]; then
  [[ -n "${2:-}" ]] || { echo "usage: $0 [--migrations <dir>]"; exit 2; }
  ROOT="$2"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--migrations <dir>]"; exit 2
fi
[[ -d "$ROOT" ]] || { echo "FAIL $ROOT is not a directory"; exit 2; }

REQ=(paycraft_attempt_alerts_digest paycraft_attempt_stitch paycraft_tenant_alerts paycraft_attempt_insights)
missing=()
for name in "${REQ[@]}"; do
  if ! grep -RhE --include='*.sql' "cron\.schedule\(['\"]${name}['\"]" "$ROOT" | grep -qvE '^[[:space:]]*--'; then
    missing+=("$name")
  fi
done
problems=()
if ((${#missing[@]})); then
  for m in "${missing[@]}"; do problems+=("cron schedule missing: $m"); done
fi

# Exactly one live insights schedule.
insight_jobs="$(grep -RhoE --include='*.sql' "^[^-]*cron\.schedule\(['\"][A-Za-z0-9_-]*insight[A-Za-z0-9_-]*['\"]" "$ROOT" \
  | grep -oE "['\"][A-Za-z0-9_-]+['\"]" | tr -d "'\"" | sort -u || true)"
n_insight_jobs="$(printf '%s' "$insight_jobs" | grep -c . || true)"
if [[ "$n_insight_jobs" -gt 1 ]]; then
  problems+=("more than one insights schedule: $(printf '%s' "$insight_jobs" | tr '\n' ' ')")
fi

# The last definition of attempt_insights_dispatch() must dispatch the edge function.
last_def=""
while IFS= read -r f; do
  if grep -qiE '^[[:space:]]*CREATE (OR REPLACE )?FUNCTION (public\.)?attempt_insights_dispatch[[:space:]]*\(' "$f"; then last_def="$f"; fi
done < <(find "$ROOT" -maxdepth 1 -name '*.sql' | LC_ALL=C sort)
if [[ -z "$last_def" ]]; then
  problems+=("attempt_insights_dispatch not defined by any migration")
else
  body="$(awk 'BEGIN{IGNORECASE=1} tolower($0) ~ /^[[:space:]]*create (or replace )?function (public\.)?attempt_insights_dispatch[[:space:]]*\(/ {on=1; body=""} on {body = body $0 "\n"; if ($0 ~ /^[[:space:]]*END;?[[:space:]]*\$\$;?/ || $0 ~ /END;[[:space:]]*\$\$;/) on=0} END {printf "%s", body}' "$last_def")"
  if ! printf '%s\n' "$body" | grep -vE '^[[:space:]]*--' | grep -qE "paycraft_function_post\(['\"]attempt-insights['\"]\)"; then
    problems+=("attempt_insights_dispatch ($(basename "$last_def")) does not call paycraft_function_post('attempt-insights')")
  fi
fi

if ((${#problems[@]})); then
  printf 'FAIL %s\n' "${problems[@]}"
  exit 1
fi
echo "PASS attempt cron (4/4 schedules present; one insights schedule; dispatcher calls attempt-insights in $(basename "$last_def"))"
