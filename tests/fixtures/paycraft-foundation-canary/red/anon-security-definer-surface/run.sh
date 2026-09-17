#!/usr/bin/env bash
# RED — no SECURITY DEFINER function in `public` may be anon-executable outside the allowlist.
#
# This is the schema-wide form of the `anon-rpc-write` canary sitting beside it. That one proves the
# hole for ONE function; this one proves it for every function there will ever be, which is what the
# class actually needs — because the defect does not arrive as a new idea, it arrives as a paste.
#
# The history, in one line: `REVOKE ALL ON FUNCTION … FROM anon` reads like a lock and is not one.
# PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION, `anon` inherits through PUBLIC,
# and revoking from `anon` leaves the PUBLIC grant untouched. Migrations 094–097 closed the class
# across the schema; migration 103 reopened it for eight functions by copying the pre-094 idiom
# forward, and one of them — `tenant_provider_resolve` — had no in-body authorisation check either,
# so an anonymous caller holding the shipped publishable key and a tenant UUID could read that
# tenant's provider connection (service-account email, operator email, package name). Closed by 105.
#
# A new function that legitimately needs anon (the SDK-facing config/entitlement readers) is added to
# ALLOWED below, deliberately and visibly. That list is the point: it makes "anon can reach this"
# a decision someone wrote down rather than a default nobody noticed.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?

# The allowlist is BY SIGNATURE, not by name, and that is the whole point of it.
#
# `is_premium` and `get_subscription` each have TWO overloads: the `(p_server_token, p_api_key)` pair
# the SDK calls, which authorises on a capability the caller must already hold — and a v1
# `(user_email text)` leftover guarded by nothing at all, which answered "is this address a paying
# customer?" for any email typed by anyone holding the shipped publishable key. A name-based
# allowlist keeps that second one open while looking correct. (Closed by 107.)
#
# These nine are the complete set the SDK reaches over PostgREST; everything else it uses goes
# through an Edge Function holding the service-role key. Adding a row here must mean an SDK call was
# added, not that a migration turned red.
ALLOWED_SIGS="cancel_subscription(p_provider text, p_subscription_id text, p_api_key text)
get_entitlements(p_app_user_id text, p_api_key text)
check_premium_with_device(p_server_token text, p_api_key text)
get_subscription(p_server_token text, p_api_key text)
is_premium(p_server_token text, p_api_key text)
is_trial_eligible(p_server_token text, p_api_key text)
register_device(p_email text, p_platform text, p_device_name text, p_device_id text, p_mode text, p_api_key text)
revoke_device(p_server_token text, p_target_token text, p_api_key text)
transfer_to_device(p_server_token text, p_new_device_token text, p_api_key text)"

actual="$(psql_val "
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef                                    -- SECURITY DEFINER only
  AND has_function_privilege('anon', p.oid, 'execute')
ORDER BY 1
")"

offenders="$(comm -23 <(printf '%s\n' "$actual" | sed '/^$/d' | sort) \
                      <(printf '%s\n' "$ALLOWED_SIGS" | sort))"

if [ -n "${offenders//[[:space:]]/}" ]; then
    echo "FAIL — SECURITY DEFINER function(s) executable by anon and not allowlisted:"
    printf '%s\n' "$offenders" | sed 's/^/         /'
    echo
    echo "  Fix with:  REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon;"
    echo "             GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;"
    echo "  REVOKE ... FROM anon alone does NOT work — the grant lives on PUBLIC."
    exit 1
fi

echo "OK — every SECURITY DEFINER function in public is anon-closed or allowlisted"
exit 0
