#!/usr/bin/env bash
# AC-19 — the dashboard chain and the edge chain must agree for the same request.
set -uo pipefail
command -v deno >/dev/null 2>&1 || { echo "SKIP — deno not installed" >&2; exit 2; }
exec deno test --allow-read --no-check --quiet "$(cd "$(dirname "$0")" && pwd)/equivalence_test.ts"
