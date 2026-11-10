#!/usr/bin/env bash
# api-split-diff.sh — the 3.0 public-API gate for the core split (paycraft-core-split GOAL AC-4a).
#
# Compares the 2.5.2 baseline dumps of :cmp-paycraft (infra/api-baseline/2.5.2) with the union of the
# post-split dumps (cmp-paycraft-core/api + cmp-paycraft/api). The split moves declarations between
# modules without renaming packages, so the union must still contain every 2.5.2 declaration — except
# the ones GOAL D5 deliberately changes (the BillingBenefit class itself; BenefitIcon is new).
# Additions are allowed. Both binary-compatibility-validator formats are read (jvm .api and .klib.api).
#
# What makes a declaration "the same":
#   - its enclosing declaration (a member that moved between classes reads as removed);
#   - in klib dumps, the TARGETS it exists on: a per-declaration `// Targets: [...]` annotation is part of
#     the key, and each file's header target set is compared too, so a declaration that stops existing on
#     iOS or JS while surviving on wasmJs is a removal, not a match.
# The D5 allow-list matches the OWNER only (the BillingBenefit / BenefitIcon class line and its own
# members) — another class's member that merely mentions BillingBenefit in its signature is still gated.
#
# Not covered here: the Android target. binary-compatibility-validator does not dump the
# `com.android.kotlin.multiplatform.library` target; infra/android-api-check.sh gates it.
#
# Usage: bash infra/api-split-diff.sh --baseline <dir> --current <dir> [--current <dir> ...]
# Exit 0 = only D5 / D11 declarations removed/changed · 1 = anything else removed/changed · 2 = usage error.
set -euo pipefail

# Compose-compiler stability synthetics are not source API: the JVM `$stable` field and the klib
# `$stableprop` / `$stableprop_getter` the Compose compiler adds to every class it compiles.
# cmp-paycraft-core is built WITHOUT the Compose compiler (it has no Compose), so its classes no longer
# carry them. Consequence for consumers: see MIGRATION_3.0.md ("Compose stability").
SYNTHETIC='[$]stableprop|field [$]stable I$'
# D5: the BillingBenefit class (and its members) changed shape; BenefitIcon is new.
D5_CLASS='class com[/.]mobilebytelabs[/.]paycraft[/.]model/(BillingBenefit|BenefitIcon)([^A-Za-z0-9_$]|$)'
# D11 (one subscription, up to N devices — PayCraft migration 178): three data classes gained
# defaulted fields (activeDevices / maxDevices). Source-compatible — every existing call compiles — but a
# data class's constructor and copy() change shape. ONLY those members of ONLY these classes are allowed;
# any other member of them (a getter, a component) is still gated.
# Matched on the qualified name, which the jvm dump writes `class com/…/BillingState$DeviceConflict` and the
# klib dump `com.mobilebytelabs.paycraft.model/BillingState.DeviceConflict|…` for a nested class.
D11_CLASS='com[/.]mobilebytelabs[/.]paycraft[/.](network[/.]RegisterDeviceResult|model[/.]BillingState[$.](DeviceConflict|OwnershipVerified))([^A-Za-z0-9_$]|$)'
D11_MEMBER='(<init>|fun copy[ (]|copy[$]default)'

BASE=""
CUR=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) BASE="${2:-}"; shift 2 ;;
    --current) CUR+=("${2:-}"); shift 2 ;;
    *) echo "usage: $0 --baseline <dir> --current <dir>..." >&2; exit 2 ;;
  esac
done
[[ -d "$BASE" && ${#CUR[@]} -gt 0 ]] || { echo "usage: $0 --baseline <dir> --current <dir>..." >&2; exit 2; }
for d in "${CUR[@]}"; do [[ -d "$d" ]] || { echo "missing dump dir: $d" >&2; exit 2; }; done

# One line per declaration: "[targets] owner :: declaration" (owner omitted at top level).
flatten() {
  local f
  while IFS= read -r -d '' f; do
    awk '
      FNR == 1 { header = 1; tgt = ""; d = 0 }
      header && /^\/\/ Library unique name:/ { header = 0; next }
      header && /^\/\/ Targets:/ { print "@file-targets " $0; next }
      header && /^\/\// { next }
      header && NF == 0 { next }
      { header = 0 }
      /^[[:space:]]*\/\/ Targets:/ { tgt = $0; sub(/^[[:space:]]*\/\/ /, "", tgt); next }
      /^[[:space:]]*\/\// || NF == 0 { next }
      /^[[:space:]]*\}[[:space:]]*$/ { if (d > 0) d--; next }
      {
        key = (tgt != "" ? "[" tgt "] " : "")
        tgt = ""
        line = key (d > 0 ? owner[d] " :: " : "") $0
        print line
        if ($0 ~ /\{[[:space:]]*(\/\/.*)?$/) owner[++d] = $0
      }
    ' "$f"
  done < <(find "$@" -name '*.api' -print0) | tr -s ' \t' ' ' |
    # Compose resources shard its generated string accessors over String<N>_commonMainKt files; adding a
    # string can move an accessor to another shard. `Res.string.x` is unchanged, so the shard number is
    # not API — an accessor that really disappears still reads as removed.
    sed -E 's/String[0-9]+_commonMain/StringN_commonMain/g' | sort -u
}

# stdin: removed lines → stdout: the ones NOT allowed (compose synthetics + the D5 class and its members)
not_allowed() {
  awk -v d5="$D5_CLASS" -v d11="$D11_CLASS" -v d11m="$D11_MEMBER" -v syn="$SYNTHETIC" '
    $0 ~ syn { next }
    {
      head = $0; member = ""
      i = index(head, " :: ")
      if (i > 0) { member = substr(head, i + 4); head = substr(head, 1, i - 1) }   # owner :: member
      if (head ~ d5) next
      if (head ~ d11 && member ~ d11m) next
      print
    }'
}

removed="$(comm -23 <(flatten "$BASE") <(flatten "${CUR[@]}") | not_allowed || true)"
if [[ -n "$removed" ]]; then
  echo "FAIL — declarations removed or changed outside GOAL D5 / D11 ($(printf '%s\n' "$removed" | wc -l | tr -d ' ')):"
  printf '%s\n' "$removed" | head -40
  exit 1
fi
echo "PASS — only D5 (BillingBenefit/BenefitIcon) and D11 (device-limit data-class constructors/copy) changed"
