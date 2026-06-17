#!/usr/bin/env bash
#
# infra/zero-leak-check.sh
#
# Phase 2 T12 of paycraft-v2-production-readiness — G-2 zero-leak validator.
# Fails if any code in the production runtime path still references the legacy
# `paycraft.cloud` domain. The legitimate historical mentions (CHANGELOG v2.0
# announcement section, the `cmp-paycraft.PayCraftBackend` migration comment)
# are listed as ALLOWLIST entries below.
#
# Exit codes:
#   0 — clean (no leaks; G-2 PASS)
#   1 — leaks found in non-allowlisted paths
#   2 — invocation error (no git, etc.)
#
# Use as a pre-commit hook OR as a CI gate. Both forms are wired in
# `.github/workflows/zero-leak-check.yml` (Phase 2 T8 — separate file).

set -euo pipefail

# Paths under SCAN are everything ext .ts/.tsx/.kt/.md/.yaml/.json/.html in the
# production runtime. Build outputs + node_modules + cmp-paycraft/build/ are
# excluded by find filters.
SEARCH_TERM='paycraft\.cloud'

# Files allowed to mention `paycraft.cloud` (historical or doc-only refs).
# Add to this list with EXPLICIT REASON.
ALLOWLIST=(
    # v2.0 announcement section — historical record of what shipped on the
    # original domain. Editing would be revisionist (RESEARCH.md D1).
    'CHANGELOG.md'

    # The /paycraft-adopt skill is shipped to consumer apps and references
    # the old domain in its training examples — flips next time we re-publish
    # the skill from framework. Out of P2 scope.
    'paycraft-adopt-*'

    # The paycraft-trial-support feature branch had its own /paycraft-adopt
    # variant; same as above.
    '.claude/commands/paycraft-adopt*'

    # This validator script itself — needs to MENTION the string to detect it.
    'infra/zero-leak-check.sh'

    # CI workflow for this validator — same reason.
    '.github/workflows/zero-leak-check.yml'
)

# Build allowlist grep pattern (escape glob → regex via |)
ALLOW_PATTERN=$(IFS='|'; echo "${ALLOWLIST[*]}" | sed 's|\*|.*|g; s|\.|\\.|g')

# Find candidate files in tracked-source paths.
candidates=$(git ls-files \
    | grep -E '\.(ts|tsx|kt|kts|md|yaml|yml|json|html|sql|sh)$' \
    | grep -v -E '^(node_modules|\.next|build|dist|\.gradle|cmp-paycraft/build)/' \
    || true)

leaks=$(printf '%s\n' "$candidates" | while read -r f; do
    [ -z "$f" ] && continue
    # Skip allowlisted paths
    if echo "$f" | grep -qE "$ALLOW_PATTERN"; then
        continue
    fi
    # Search; if hit, emit "file:lineno: matched-line"
    grep -nH "$SEARCH_TERM" "$f" 2>/dev/null || true
done)

if [ -z "$leaks" ]; then
    echo "✅ G-2 zero-leak check PASS — no 'paycraft.cloud' references in production paths."
    exit 0
fi

cat <<EOF
❌ G-2 zero-leak check FAIL — 'paycraft.cloud' references found in non-allowlisted paths:

$leaks

Per RESEARCH.md D1, the canonical production domain is paycraft.mobilebytesensei.com.
To resolve:

  1. Replace the reference with paycraft.mobilebytesensei.com (or the relevant
     subdomain: api., docs., status.).
  2. If the reference is a legitimate historical mention, add the file to the
     ALLOWLIST inside infra/zero-leak-check.sh with EXPLICIT REASON.
  3. Re-run: bash infra/zero-leak-check.sh

EOF
exit 1
