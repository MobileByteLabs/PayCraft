#!/usr/bin/env bash
# AC-12 / AC-15 / AC-17 — runs the shipped resolver's own test suite.
set -uo pipefail
command -v deno >/dev/null 2>&1 || { echo "SKIP — deno not installed" >&2; exit 2; }
exec deno test --allow-read --quiet "$(cd "$(dirname "$0")" && pwd)/chain_test.ts"
