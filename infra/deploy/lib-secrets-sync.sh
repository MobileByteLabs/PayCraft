#!/usr/bin/env bash
# lib-secrets-sync.sh — deploy.sh phase 2: vault → Cloudflare PAGES secrets, with no soft-pass.
#
# The dashboard is a Cloudflare Pages project, so the write is `wrangler pages secret put <ENV>
# --project-name <project>` — NOT `wrangler secret put` (that targets a Worker, and this project has
# had no Worker since the next-on-pages move).
#
# Why this is a library: phase 2 used to print "✗ <ENV> … failed" for every secret it could not write
# and then `return 0`, so the phase reported PASS over four failed secrets — and it discarded
# wrangler's stderr, so the reason was gone too. A phase whose success is unconditional is not a
# check. Extracted so a canary can drive it with a stubbed wrangler and prove a failed put fails.
#
# Map format (dashboard/cloudflare-secrets.map), one per line:
#     ENV_NAME = vault-alias
#     ENV_NAME = vault-alias | optional: <why the app works without it>
# Every entry is REQUIRED unless it says otherwise, with a reason. A required alias that does not
# resolve FAILS the phase: "not in the vault" and "the vault read failed" are indistinguishable here,
# and skipping either silently ships a dashboard missing a credential it needs.
#
# Contract: the caller defines `secret_to_file <alias> <file>` (non-zero / empty file = unresolved)
# and exports CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN for wrangler.

_trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; printf '%s' "${s%"${s##*[![:space:]]}"}"; }

# cf_pages_secrets_sync <map> <pages-project>  → 0 only if every required secret was written.
cf_pages_secrets_sync() {
    local map="$1" project="$2"
    local set=0 skipped=0 failed=0 line env rest alias opt reason vf out
    [[ -f "$map" ]] || { echo "  ✗ secret map not found: $map"; return 1; }

    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if [[ "$line" != *=* ]]; then
            echo "  ✗ malformed map line (no '='): $line"; failed=$((failed+1)); continue
        fi
        env="$(_trim "${line%%=*}")"; rest="${line#*=}"
        alias="$(_trim "${rest%%|*}")"; opt=""; reason=""
        [[ "$rest" == *"|"* ]] && opt="$(_trim "${rest#*|}")"
        if [[ -n "$opt" ]]; then
            if [[ "$opt" =~ ^optional:[[:space:]]*(.+)$ ]]; then
                reason="${BASH_REMATCH[1]}"
            else
                echo "  ✗ $env : unrecognised qualifier '$opt' (only 'optional: <reason>')"; failed=$((failed+1)); continue
            fi
        fi
        if [[ -z "$env" || -z "$alias" ]]; then
            echo "  ✗ malformed map line: $line"; failed=$((failed+1)); continue
        fi

        vf="$(mktemp -t cf-sec-XXXXXX)"; chmod 600 "$vf"
        if ! secret_to_file "$alias" "$vf" || [[ ! -s "$vf" ]]; then
            if [[ -n "$reason" ]]; then
                echo "  ↷ $env ← $alias : not in vault — optional ($reason)"; skipped=$((skipped+1))
            else
                echo "  ✗ $env ← $alias : vault read failed and the secret is REQUIRED"; failed=$((failed+1))
            fi
            rm -f "$vf"; continue
        fi

        if out="$(npx --yes wrangler pages secret put "$env" --project-name "$project" < "$vf" 2>&1)"; then
            echo "  ✓ $env ← $alias"; set=$((set+1))
        else
            echo "  ✗ $env ← $alias : wrangler pages secret put failed:"
            # wrangler's own words are the diagnosis. Any line carrying the value is dropped first
            # (grep -F against the value file, so the value is never read into this shell).
            printf '%s\n' "$out" | grep -vF -f "$vf" | tail -n 4 | sed 's/^/      /'
            failed=$((failed+1))
        fi
        rm -f "$vf"
    done < "$map"

    echo "  Pages secrets ($project) — set: $set · skipped(optional): $skipped · failed: $failed"
    [[ "$failed" -eq 0 ]]
}
