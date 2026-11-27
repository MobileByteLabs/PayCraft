import { ACTIVE_APP_HINT_COOKIE, isSpaPath } from "./spa-paths"
import { API_HOSTS, MCP_HOSTS } from "./hosts"

/** Does this request get the Vite dashboard's shell? (The API / MCP hosts are the middleware's, never the shell's.) */
export function wantsSpaShell(method: string, url: URL): boolean {
  return method === "GET" && isSpaPath(url.pathname) && !API_HOSTS.has(url.hostname) && !MCP_HOSTS.has(url.hostname)
}

function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

/**
 * The Set-Cookie that keeps the shell's readable active-app hint in step with the httpOnly choice, or null when
 * it already is. No choice on the server (first app) clears a stale hint, so the shell can't follow it elsewhere.
 */
export function activeAppHintCookie(cookieHeader: string | null): string | null {
  const active = readCookie(cookieHeader, "paycraft_active_app_id")
  const hint = readCookie(cookieHeader, ACTIVE_APP_HINT_COOKIE)
  if (active && hint !== active) return `${ACTIVE_APP_HINT_COOKIE}=${active}; Path=/; Max-Age=31536000; SameSite=Lax`
  if (!active && hint) return `${ACTIVE_APP_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  return null
}

/** What next.config.js sets on every Next.js response — the shell bypasses Next, so it carries them itself. */
export const SHELL_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-cache",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
