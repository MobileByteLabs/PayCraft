#!/usr/bin/env bash
# AC-10 — is_entitlement_current treats a NULL expiry as "does not expire".
#
# Includes the negative arms deliberately: a predicate that returned true for everything would
# satisfy the positive cases and silently grant entitlement to expired and refunded records.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
check() { # check <sql> <expected> <label>
  local got; got="$(psql_val "$1")"
  [ "$got" = "$2" ] || { echo "AC-10 FAIL — $3: got '$got', expected '$2'" >&2; return 1; }
}
check "SELECT public.is_entitlement_current('active', NULL);"                            t "NULL expiry is current"
check "SELECT public.is_entitlement_current('active', now() + interval '10 years');"     t "far-future expiry is current"
check "SELECT public.is_entitlement_current('trial', NULL);"                             t "trial with NULL expiry"
check "SELECT public.is_entitlement_current('in_grace_period', NULL);"                   t "grace counts as current"
check "SELECT public.is_entitlement_current('active', now() - interval '1 day');"        f "past expiry is NOT current"
check "SELECT public.is_entitlement_current('expired', NULL);"                           f "expired state is NOT current"
check "SELECT public.is_entitlement_current('refunded', NULL);"                          f "refunded is NOT current"
check "SELECT public.is_entitlement_current('on_billing_retry', NULL);"                  f "billing retry is NOT current"
echo "AC-10 PASS — NULL expiry honoured indefinitely; expired/refunded/retry still refused"
