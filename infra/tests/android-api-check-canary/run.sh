#!/usr/bin/env bash
# Canary for infra/android-api-check.sh (--compare seam, no Gradle build): red-removed drops a public
# Android method, red-manifest loses the startup/auth entries, red-d11-member drops a device-limit class's
# getter (only its constructor/copy may change), red-string-removed loses a string accessor (moving shards
# is allowed, disappearing is not) — all must fail; green must pass.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../android-api-check.sh"; fail=0
for r in red-removed red-manifest red-d11-member red-string-removed; do
  if bash "$GATE" --compare "$HERE/base.sigs" "$HERE/$r/current.sigs" "$HERE/$r/AndroidManifest.xml" > /dev/null 2>&1; then
    echo "$r: exit 0 — gate missed it"; fail=1; fi
done
bash "$GATE" --compare "$HERE/base.sigs" "$HERE/green/current.sigs" "$HERE/green/AndroidManifest.xml" > /dev/null 2>&1 || { echo "green: rejected"; fail=1; }
[[ $fail -eq 0 ]] && echo "canary OK (4 red exit 1, green exit 0)"
exit $fail
