#!/usr/bin/env bash
#
# Every @Deprecated in the SDK must name the version that removes it.
#
# This is NOT a rule that things must be deprecated. The SDK's consumers are all ours
# (reels-downloader, steady, cappy) and are updated directly, so the default is to change an API and
# fix its call sites in the same change — a deprecation window warns nobody when you own every call
# site. See paycraft-instructions/PUBLIC_API.md.
#
# But a deprecation that DOES exist is a promise to somebody, and a promise with no date is not one:
# it either lives forever as permanent clutter, or it disappears in a future release having warned
# no one. `ConfigClient` sat in exactly that state — "superseded by the resilience chain", no
# removal version — until this gate was written.
#
# `replaceWith` is deliberately NOT required. It is correct only when the migration is a mechanical
# substitution (`MINIMAL` → `BRANDED_STACK`); requiring it everywhere would push authors to invent
# quick-fixes for migrations that are not substitutions, and a wrong quick-fix is worse than none
# because an IDE applies it without the developer reading it.
#
# Usage: verify-deprecation-policy.sh [source-root]   → exit 0 pass / 1 violations
set -uo pipefail
ROOT="${1:-cmp-paycraft/src}"

violations=$(python3 - "$ROOT" <<'PY'
import re, sys, glob, os
root = sys.argv[1]
for f in glob.glob(os.path.join(root, '**', '*.kt'), recursive=True):
    src = open(f, encoding='utf-8', errors='ignore').read()
    # Match the annotation and its full argument list, including nested parens (ReplaceWith(...)).
    for m in re.finditer(r'@Deprecated\s*\(', src):
        i, depth, end = m.end() - 1, 0, len(src) - 1
        for j in range(i, len(src)):
            if src[j] == '(':
                depth += 1
            elif src[j] == ')':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        block = src[i:end + 1]
        if not re.search(r'\d+\.\d+\.\d+', block):
            print(f"{f}:{src[:m.start()].count(chr(10)) + 1}")
PY
)

if [ -n "$violations" ]; then
    echo "FAIL — @Deprecated without a stated removal version:"
    printf '%s\n' "$violations" | sed 's/^/    /'
    echo
    echo "  Add the version that removes it, e.g."
    echo '      message = "Use BRANDED_STACK — minimal will be removed in cmp-paycraft 3.0.0"'
    echo "  See paycraft-instructions/PUBLIC_API.md - Removing something from this surface."
    exit 1
fi

echo "OK — every @Deprecated names the version that removes it"
exit 0
