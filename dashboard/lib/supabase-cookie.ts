/**
 * The dashboard's Supabase session cookie, pinned. @supabase/ssr names it after the first label of the Supabase
 * URL's host, so moving the dashboard to the edge proxy (edge.paycraft.mobilebytesensei.com) would have renamed it
 * to `sb-edge-auth-token` and signed every operator out. Every client — browser, server, middleware, the OAuth
 * callback — passes this name, so they all read and write the same cookie whatever URL they use.
 */
export const SUPABASE_AUTH_COOKIE = "sb-mlwfgytjxlqyfxcgpysm-auth-token"

export const supabaseCookieOptions = { name: SUPABASE_AUTH_COOKIE } as const
