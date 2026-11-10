#!/usr/bin/env bash
# web-api-diff.sh — the browser SDK's exported surface stays stable and valid (paycraft-core-split AC-6 / D7).
#
# Websites call PayCraftWeb directly (reelsdownloader-web), so a removed or re-typed export breaks them at
# runtime with no compiler in between. Compared with the committed 2.5.2 snapshot:
#   1. every exported class member AND every top-level `export declare` (const / function / enum / class)
#      must still exist with the same signature — additions are allowed;
#   2. no top-level exported name may be declared twice (a strict `tsc` rejects the file);
#   3. when TypeScript is available (Kotlin's npm toolchain installs it), the current .d.mts must type-check
#      with skipLibCheck OFF — the setting a strict consumer uses;
#   4. no .mjs next to the current .d.mts may import a bare npm specifier: the library ships with
#      `"dependencies": {}`, so such an import would fail in every site that vendors it.
#
# Usage: bash infra/web-api-diff.sh [<baseline.d.mts> [<current.d.mts>]]
#   defaults: cmp-paycraft-web/api/paycraft-web-2.5.2.d.mts vs the production library build output
#   TSC=<path>  TypeScript compiler (default: build/js/node_modules/.bin/tsc if present; skipped otherwise)
# Exit 0 = OK · 1 = removed/changed/duplicate/invalid/bare import · 2 = missing input.
set -euo pipefail

BASE="${1:-cmp-paycraft-web/api/paycraft-web-2.5.2.d.mts}"
CUR="${2:-cmp-paycraft-web/build/dist/js/productionLibrary/paycraft-web.d.mts}"
[[ -s "$BASE" && -s "$CUR" ]] || { echo "FAIL missing d.mts ($BASE | $CUR)"; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSC="${TSC:-$ROOT/build/js/node_modules/.bin/tsc}"
fail=0

# One line per exported member as "Class::signature", plus every top-level export line as "@top <line>".
# Kotlin's `$metadata$` namespaces and doc comments are dropped (they are not API).
members() {
  awk '
    /^export declare namespace / { c = ""; next }
    /^export declare class / { c = $4; print "@top " $0; next }
    /^export declare / { c = ""; print "@top " $0; next }
    /^(type|declare function) / { print; next }
    c != "" && /^    [^\/ ]/ { l = $0; sub(/^ +/, "", l); print c "::" l }
  ' "$1" | sort -u
}

removed="$(comm -23 <(members "$BASE") <(members "$CUR"))"
added="$(comm -13 <(members "$BASE") <(members "$CUR"))"
[[ -n "$added" ]] && printf 'added (allowed):\n%s\n' "$added"
if [[ -n "$removed" ]]; then
  printf 'FAIL removed/changed:\n%s\n' "$removed"
  fail=1
fi

dups="$(grep -oE '^export declare (const|let|var|function|class|enum|namespace) [A-Za-z0-9_$]+' "$CUR" |
  grep -v ' namespace ' | awk '{print $NF}' | sort | uniq -d || true)"
if [[ -n "$dups" ]]; then
  printf 'FAIL duplicate top-level exports:\n%s\n' "$dups"
  fail=1
fi

if [[ -x "$TSC" ]]; then
  tmp="$(mktemp -d)"
  cp "$CUR" "$tmp/check.d.mts"
  if ! "$TSC" --noEmit --strict --skipLibCheck false --lib es2020,dom --module es2020 --target es2020 "$tmp/check.d.mts" > "$tmp/tsc.out" 2>&1; then
    echo "FAIL tsc (skipLibCheck off) rejects the declarations:"
    head -10 "$tmp/tsc.out"
    fail=1
  fi
  rm -rf "$tmp"
else
  echo "note: TypeScript not found at $TSC — strict d.mts check skipped (run ./gradlew kotlinNpmInstall)"
fi

dist="$(dirname "$CUR")"
bare="$(grep -lE "(^|[^.])(from|import)[[:space:]]*['\"][^./'\"][^'\"]*['\"]" "$dist"/*.mjs 2> /dev/null || true)"
if [[ -n "$bare" ]]; then
  printf 'FAIL .mjs importing a bare npm specifier (the package ships "dependencies": {}):\n%s\n' "$bare"
  fail=1
fi

[[ $fail -eq 0 ]] && echo "no removed/changed members"
exit "$fail"
