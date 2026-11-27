/**
 * Hostnames that serve the machine API. On these, `/v1/*` is rewritten to `/api/v1/*` so the public
 * surface reads `https://api.paycraft.mobilebytesensei.com/v1/readiness` rather than leaking the
 * Next.js route layout into the documented URL.
 *
 * The host is served by the same Worker as the dashboard. Pointing it at Supabase directly
 * — which is what it used to do — cannot work: Supabase serves custom hostnames only with the paid
 * Custom Domain add-on, so the record resolved and every TLS handshake failed.
 */
export const API_HOSTS: ReadonlySet<string> = new Set(["api.paycraft.mobilebytesensei.com"])

/**
 * The MCP host. Serves ONE thing: the Model Context Protocol endpoint at its root.
 *
 * A separate hostname rather than a path on the API host because an MCP endpoint is configured by
 * URL in a client's settings, and a bare origin is what people paste. It also keeps the blast radius
 * legible — anything else on this host 404s, so a misconfigured client cannot wander into the
 * dashboard.
 */
export const MCP_HOSTS: ReadonlySet<string> = new Set(["mcp.paycraft.mobilebytesensei.com"])
