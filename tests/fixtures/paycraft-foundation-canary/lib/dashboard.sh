#!/usr/bin/env bash
# Shared preconditions for the dashboard HTTP/browser canaries (AC-29, AC-30).
#
# These need three things the pure-SQL canaries do not: the local Supabase stack, a running dev
# server on PC_DASH_URL, and a minted session cookie. Each is checked explicitly and SKIPs (exit 2)
# with the command that fixes it — a canary that silently passes because it never ran is worse than
# one that fails.
set -uo pipefail
PC_DASH_URL="${PC_DASH_URL:-http://127.0.0.1:3999}"
PC_COOKIE_FILE="${PC_COOKIE_FILE:-/tmp/pc-cookie.txt}"
export PC_DASH_URL PC_COOKIE_FILE

require_dashboard() {
    if ! curl -sf -o /dev/null --max-time 5 "$PC_DASH_URL/" 2>/dev/null; then
        echo "SKIP — dashboard not reachable at $PC_DASH_URL." >&2
        echo "       Start it against the LOCAL stack (never a production env)." >&2
        return 2
    fi
    if [ ! -s "$PC_COOKIE_FILE" ]; then
        echo "SKIP — no session cookie at $PC_COOKIE_FILE (mint one for the canary user)." >&2
        return 2
    fi

    # The cookie FILE existing is not the same as the SESSION being usable. A `supabase db reset`
    # wipes auth.users and tenant_admins while leaving the cookie on disk, so the old check passed
    # its preconditions and the tests then failed on their assertions — which reads as a product
    # regression when it is actually a dead session. Ask the dashboard whether the session still
    # authenticates, and SKIP if not.
    local probe
    probe="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
        -H "Cookie: $(cat "$PC_COOKIE_FILE")" "$PC_DASH_URL/api/products/00000000-0000-0000-0000-000000000000" 2>/dev/null)"
    case "$probe" in
        # 404 = authenticated and the row genuinely does not exist. That is the healthy answer.
        404|200) : ;;
        401|403|000)
            echo "SKIP — session at $PC_COOKIE_FILE is no longer valid (probe HTTP $probe)." >&2
            echo "       A db reset wipes auth.users; re-seed and mint a fresh cookie." >&2
            return 2 ;;
        302|307)
            echo "SKIP — dashboard redirected the probe (HTTP $probe), session likely expired." >&2
            return 2 ;;
        *)
            echo "SKIP — unexpected probe status $probe; refusing to run against an unknown state." >&2
            return 2 ;;
    esac
}

# Walks up to find the framework root rather than counting `../..` levels. Counting is brittle —
# it was already wrong once in this suite, and the failure mode is a SKIP that looks like a
# legitimate "dependency not running" rather than a broken path.
find_web_debug_runner() {
    local d="$1"
    while [ "$d" != "/" ]; do
        if [ -f "$d/.claude-runtime/scripts/web-debug-bootstrap.sh" ]; then
            printf '%s\n' "$d/.claude-runtime/scripts/web-debug-bootstrap.sh"; return 0
        fi
        d="$(dirname "$d")"
    done
    return 1
}
