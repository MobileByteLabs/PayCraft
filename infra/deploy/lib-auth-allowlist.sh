#!/usr/bin/env bash
#
# lib-auth-allowlist.sh — the DECISION half of deploy.sh's phase 2.5 AUTH ALLOWLIST.
#
# Split out from the phase so it can be tested without a Supabase project, a PAT, or a network.
# The phase keeps the I/O (GET the auth config, PATCH it back); everything that decides WHAT should
# change lives here, where the canary can drive it with fixtures.
#
# The bug this guards against, in full:
#
#   GoTrue does not reject an OAuth `redirectTo` that falls outside `uri_allow_list`. It silently
#   substitutes `site_url` and continues. So a staging deploy missing its entry looks completely
#   healthy — 200s everywhere, no console error, no server log — right up until someone signs in and
#   lands on PRODUCTION. There is nothing to grep for; the only symptom is the wrong host in the
#   address bar, which is easy to read as "the deploy didn't work" rather than "auth sent me away".
#
# Sourced by deploy.sh and by tests/auth-allowlist-canary/run.sh.

# ──────────────────────────────────────────────────────────────────────────────────────────────
# allowlist_covers <allowlist_csv> <url>
#
# True when at least one entry in the comma-separated allowlist glob-matches <url>.
#
# Coverage, not equality: `https://*.paycraft.pages.dev/**` genuinely covers
# `https://staging.paycraft.pages.dev/auth/callback`, and re-adding the specific entry beside it
# would be noise. Entries are trimmed because the Supabase dashboard lets a human paste
# "a/**, b/**" with spaces, and a space-prefixed pattern matches nothing.
# ──────────────────────────────────────────────────────────────────────────────────────────────
allowlist_covers() {
    local csv="$1" url="$2" entry
    local IFS=','
    for entry in $csv; do
        entry="${entry#"${entry%%[![:space:]]*}"}"   # ltrim
        entry="${entry%"${entry##*[![:space:]]}"}"   # rtrim
        [[ -z "$entry" ]] && continue
        # shellcheck disable=SC2053 — the RHS is a pattern on purpose.
        [[ "$url" == $entry ]] && return 0
    done
    return 1
}

# ──────────────────────────────────────────────────────────────────────────────────────────────
# auth_allowlist_missing <allowlist_csv> <staging_url> <pages_project>
#
# Prints the entries that must be ADDED, one per line; prints nothing when the allowlist already
# covers staging sign-in. Never prints an entry that is already present verbatim, so re-running is
# a no-op rather than a slow accumulation of duplicates.
#
# When coverage is absent it proposes two entries, and both earn their place:
#   • "<staging_url>/**"                  — the stable alias every staging deploy resolves to.
#   • "https://*.<project>.pages.dev/**"  — the per-deployment hash hosts (8ec2e33e.paycraft.…),
#                                           which is what you actually get handed on a rollback or
#                                           when comparing two builds side by side.
# ──────────────────────────────────────────────────────────────────────────────────────────────
auth_allowlist_missing() {
    local csv="$1" staging_url="$2" project="$3"
    local specific="${staging_url}/**"
    local wildcard="https://*.${project}.pages.dev/**"

    # The two requirements are evaluated INDEPENDENTLY. An earlier version returned early once the
    # callback URL was covered, which meant a present specific entry suppressed the wildcard — so
    # sign-in worked on staging.…pages.dev and broke on a per-deployment hash host, the failure that
    # presents as "intermittent" and costs an afternoon. (Canary case R4.)
    allowlist_covers "$csv" "${staging_url}/auth/callback" || printf '%s\n' "$specific"
    # Compare the wildcard as a literal: asking whether it is "covered" would make an existing
    # broader pattern hide it, and this entry exists precisely to cover hosts nothing else does.
    case ",${csv//[[:space:]]/}," in
        *",${wildcard},"*) : ;;
        *) printf '%s\n' "$wildcard" ;;
    esac
    return 0
}

# ──────────────────────────────────────────────────────────────────────────────────────────────
# allowlist_join <allowlist_csv> <entry>...
#
# Appends entries to the CSV, preserving existing order. Existing entries are never reordered or
# dropped: this value is PATCHed back wholesale, so anything this function loses is deleted from
# the project's auth config.
# ──────────────────────────────────────────────────────────────────────────────────────────────
allowlist_join() {
    local out="$1"; shift
    local e
    for e in "$@"; do
        [[ -z "$e" ]] && continue
        out="${out:+$out,}$e"
    done
    printf '%s' "$out"
}

# ──────────────────────────────────────────────────────────────────────────────────────────────
# parse_uri_allow_list <json>
#
# Extracts uri_allow_list from a Supabase auth-config response. Tolerates the banner line
# supabase-connect.sh prints before the JSON, and pretty-printed or single-line bodies alike.
# Prints nothing when the field is absent — an EMPTY result means "could not read", which the
# caller must not confuse with "the list is empty" (that would PATCH away every existing entry).
# ──────────────────────────────────────────────────────────────────────────────────────────────
parse_uri_allow_list() {
    printf '%s' "$1" | tr -d '\n' | sed -n 's/.*"uri_allow_list"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}
