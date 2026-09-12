#!/usr/bin/env bash
# AC-8 green — from 089 onward, tenant_products_upsert is a DELEGATE, not another full copy.
#
# The check is deliberately structural rather than "does 089 exist": what must hold is that the
# LATEST definition of the wrapper contains no INSERT of its own. A migration that adds a column
# by pasting the whole body again would still leave 089 on disk and still pass a file-existence
# test, which is how the chain reached eight copies in the first place.
#
# Takes an optional migrations dir so the RED case can point it at a tree containing a ninth copy.
set -uo pipefail
MIG="${1:-$(cd "$(dirname "$0")/../../../../.." && pwd)/supabase/migrations}"

LATEST="$(grep -l 'CREATE OR REPLACE FUNCTION public\.tenant_products_upsert\|CREATE OR REPLACE FUNCTION tenant_products_upsert' \
          "$MIG"/*.sql 2>/dev/null | sort | tail -1)"
[ -n "$LATEST" ] || { echo "AC-8 FAIL — no tenant_products_upsert definition found" >&2; exit 1; }

# Body of the wrapper in the latest file that defines it.
body="$(awk '/CREATE OR REPLACE FUNCTION (public\.)?tenant_products_upsert/,/\$fn\$;|\$function\$;|\$\$;/' "$LATEST")"

# Normalise before matching. SQL identifiers are case-insensitive and statements may wrap across
# lines, so a line-oriented case-sensitive grep is trivially evaded — `INSERT INTO TENANT_PRODUCTS`
# or `INSERT INTO\n  tenant_products` are both valid SQL that the naive check missed. G-2 promises
# "a reformatted copy still fails", and only normalisation makes that true.
norm="$(printf '%s' "$body" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')"

printf '%s' "$norm" | grep -q 'return public\._tenant_products_upsert_core' \
  || { echo "AC-8 FAIL — latest wrapper ($(basename "$LATEST")) does not delegate to the core" >&2; exit 1; }

copies="$(printf '%s' "$norm" | grep -o 'insert into tenant_products' | wc -l | tr -d ' ')"
[ "$copies" = "0" ] \
  || { echo "AC-8 FAIL — latest wrapper ($(basename "$LATEST")) carries $copies INSERT copy/copies" >&2; exit 1; }

echo "AC-8 PASS — latest wrapper is $(basename "$LATEST"): delegates, zero INSERT copies"
