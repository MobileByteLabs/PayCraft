#!/usr/bin/env bash
# release-coverage-check.sh — every cmp-* module is wired for the 3.0 release (paycraft-core-split AC-8).
#
#   - publish.yml discovers modules by `module-pattern: 'cmp-'` and no longer anchors on the single
#     hardcoded `artifact-id: 'cmp-paycraft'` (the reusable workflow publishes every cmp-*/ module whose
#     build has `mavenPublishing`; `artifact-id` only drives version lookup);
#   - release.yml assembles every cmp-* module;
#   - every cmp-* module except cmp-paycraft-web has `mavenPublishing` (so it is discovered);
#     cmp-paycraft-web must NOT (it ships vendored via /lib-integrate, never to Maven — coordinates
#     cannot be withdrawn);
#   - paycraft.version is strictly above the latest cmp-paycraft on Maven Central. This replaces the
#     workflow's verify-against-maven for 3.0.0: its artifact-id moves to cmp-paycraft-core, which has no
#     Maven history yet, so that built-in check would pass vacuously.
#
# Usage: bash infra/release-coverage-check.sh [repo-root]
#   PAYCRAFT_MAVEN_LATEST=<v>  pin the Maven version (offline / canary); default: read maven-metadata.xml
# Exit 0 = PASS · 1 = a release-wiring gap (each printed).
set -uo pipefail

R="${1:-.}"
P="$R/.github/workflows/publish.yml"
L="$R/.github/workflows/release.yml"
fail=0
no() { echo "FAIL $*"; fail=1; }

grep -qE "artifact-id: 'cmp-paycraft'$" "$P" && no "publish.yml anchors on the single cmp-paycraft artifact"
grep -q "module-pattern: 'cmp-'" "$P" || no "publish.yml lost module-pattern discovery"
grep -q "cmp-paycraft-core" "$P" || no "publish.yml does not name cmp-paycraft-core"

for d in "$R"/cmp-*/; do
  m="$(basename "$d")"
  [[ -f "$d/build.gradle.kts" ]] || continue
  grep -q ":$m:assemble" "$L" || no "release.yml does not assemble :$m"
  if [[ "$m" == cmp-paycraft-web ]]; then
    grep -q mavenPublishing "$d/build.gradle.kts" && no "$m must stay vendored-only (no mavenPublishing)"
  else
    grep -q mavenPublishing "$d/build.gradle.kts" || no "$m has no mavenPublishing (the publish workflow will not discover it)"
  fi
done

v="$(grep '^paycraft.version=' "$R/gradle.properties" | cut -d= -f2)"
m="${PAYCRAFT_MAVEN_LATEST:-$(curl -sf https://repo1.maven.org/maven2/io/github/mobilebytelabs/cmp-paycraft/maven-metadata.xml |
  sed -n 's|.*<release>\(.*\)</release>.*|\1|p')}"
if [[ -z "$m" ]]; then
  no "could not read the latest cmp-paycraft version from Maven Central (set PAYCRAFT_MAVEN_LATEST to run offline)"
elif [[ "$v" == "$m" || "$(printf '%s\n%s\n' "$m" "$v" | sort -V | tail -1)" != "$v" ]]; then
  no "paycraft.version $v is not above Maven's cmp-paycraft $m"
fi

[[ $fail -eq 0 ]] && echo "PASS — publish/release cover every cmp-* module; $v > Maven $m"
exit "$fail"
