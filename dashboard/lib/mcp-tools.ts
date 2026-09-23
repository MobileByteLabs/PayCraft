import { GET as readinessGET } from "@/app/api/v1/readiness/route"
import { GET as syncGET, POST as syncPOST } from "@/app/api/v1/sync/route"
import { GET as productsGET } from "@/app/api/v1/products/route"
import { GET as productGET } from "@/app/api/v1/products/[id]/route"
import { POST as productSyncPOST } from "@/app/api/v1/products/[id]/sync/route"
import { GET as providersGET } from "@/app/api/v1/providers/route"
import { GET as subscribersGET } from "@/app/api/v1/subscribers/route"
import { GET as entitlementsGET } from "@/app/api/v1/entitlements/route"
import { GET as couponsGET } from "@/app/api/v1/coupons/route"
import { GET as paywallGET } from "@/app/api/v1/paywall/route"
import { GET as webhooksGET } from "@/app/api/v1/webhooks/route"
import { GET as auditGET } from "@/app/api/v1/audit/route"
import { GET as tenantGET } from "@/app/api/v1/tenant/route"
import { GET as syncEventsGET } from "@/app/api/v1/sync/events/route"

/**
 * MCP tools, defined as a thin mapping onto the REST handlers.
 *
 * Each tool INVOKES THE ROUTE HANDLER rather than re-querying the database. That is the whole design
 * decision here: authentication, scope enforcement, tenant filtering, pagination clamping and the
 * confirm-count gate all live in those handlers, and a second implementation would have to keep
 * every one of them in step forever. It would drift on the first fix applied to only one side — and
 * the half that drifted would be the half enforcing who may read whose billing data.
 *
 * So a tool call is: build a Request carrying the caller's own Authorization header, hand it to the
 * same function the REST API uses, and render the result. An agent gets exactly the permissions its
 * key carries, enforced by exactly the code that enforces them for curl.
 */

type Handler = (req: Request, ctx?: any) => Promise<Response>

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  /** Marks a tool that writes to live payment providers, for clients that surface the distinction. */
  destructive?: boolean
  invoke: (args: Record<string, any>, auth: string, origin: string) => Promise<Response>
}

/** Build a Request that looks to the handler exactly like the equivalent REST call. */
function call(
  handler: Handler,
  method: "GET" | "POST",
  path: string,
  auth: string,
  origin: string,
  query?: Record<string, unknown>,
  body?: unknown,
  routeParams?: Record<string, string>,
): Promise<Response> {
  const url = new URL(path, origin)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
  }
  const req = new Request(url.toString(), {
    method,
    headers: {
      Authorization: auth,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return routeParams ? handler(req, { params: routeParams }) : handler(req)
}

const PAGING = {
  limit: { type: "integer", minimum: 1, maximum: 200, description: "Page size (default 50)." },
  offset: { type: "integer", minimum: 0, description: "Rows to skip." },
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

export const MCP_TOOLS: McpTool[] = [
  {
    name: "paycraft_readiness",
    title: "Provider readiness",
    description:
      "Whether every payment provider can transact, live and in test. Rows that need human work " +
      "carry ordered manual_steps — Google Play and App Store test mode cannot be enabled through " +
      "any API and turn green only after a real sandbox purchase. Start here when asked 'can we " +
      "test payments yet'. Requires scope readiness:read.",
    inputSchema: obj({}),
    invoke: (_a, auth, origin) => call(readinessGET, "GET", "/api/v1/readiness", auth, origin),
  },
  {
    name: "paycraft_tenant",
    title: "Tenant and key info",
    description:
      "The account this key belongs to: plan, subscriber limit, and the calling key's own scopes. " +
      "Useful first call to discover what this credential is permitted to do. Requires tenant:read.",
    inputSchema: obj({}),
    invoke: (_a, auth, origin) => call(tenantGET, "GET", "/api/v1/tenant", auth, origin),
  },
  {
    name: "paycraft_products",
    title: "List products",
    description:
      "The product catalogue with each provider's synced ids, so one call answers whether a product " +
      "landed at Stripe, Play and the App Store. Requires products:read.",
    inputSchema: obj({ sku: { type: "string" }, type: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(productsGET, "GET", "/api/v1/products", auth, origin, a),
  },
  {
    name: "paycraft_product",
    title: "Get one product",
    description: "One product with its per-currency pricing rows. Requires products:read.",
    inputSchema: obj({ id: { type: "string", description: "Product UUID." } }, ["id"]),
    invoke: (a, auth, origin) =>
      call(productGET, "GET", `/api/v1/products/${a.id}`, auth, origin, undefined, undefined, {
        id: String(a.id),
      }),
  },
  {
    name: "paycraft_providers",
    title: "List provider connections",
    description:
      "Connected providers and their payment-link maps. Never credentials — no endpoint returns a " +
      "provider secret. Requires providers:read.",
    inputSchema: obj({ provider: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(providersGET, "GET", "/api/v1/providers", auth, origin, a),
  },
  {
    name: "paycraft_sync_report",
    title: "Drift report (read-only)",
    description:
      "What a sync WOULD change, plus the confirm_count that paycraft_sync_run requires. Always call " +
      "this before running a sync — the count is how the API knows you acted on a set someone saw. " +
      "Requires products:read.",
    inputSchema: obj({}),
    invoke: (_a, auth, origin) => call(syncGET, "GET", "/api/v1/sync", auth, origin),
  },
  {
    name: "paycraft_sync_run",
    title: "Run the sync drain (writes to live providers)",
    description:
      "BULK-WRITES to live payment providers: creates and updates products, prices, payment links " +
      "and subscription plans in every configured mode. Requires confirm_count from " +
      "paycraft_sync_report; a mismatch returns 409 rather than proceeding. A 200 does not mean " +
      "every provider succeeded — read the skipped and failed arrays. Requires products:sync.",
    inputSchema: obj(
      {
        confirm_count: {
          type: "integer",
          minimum: 0,
          description: "Must equal confirm_count from paycraft_sync_report.",
        },
      },
      ["confirm_count"],
    ),
    destructive: true,
    invoke: (a, auth, origin) =>
      call(syncPOST, "POST", "/api/v1/sync", auth, origin, undefined, {
        confirm_count: a.confirm_count,
      }),
  },
  {
    name: "paycraft_sync_product",
    title: "Sync one product (writes to live providers)",
    description:
      "Pushes a single product to its providers. No confirm_count — the subject is named explicitly. " +
      "Optionally narrow to one provider. Requires products:sync.",
    inputSchema: obj(
      {
        id: { type: "string", description: "Product UUID." },
        provider: {
          type: "string",
          enum: ["stripe", "razorpay", "cashfree", "google_play", "app_store"],
        },
      },
      ["id"],
    ),
    destructive: true,
    invoke: (a, auth, origin) =>
      call(
        productSyncPOST,
        "POST",
        `/api/v1/products/${a.id}/sync`,
        auth,
        origin,
        { provider: a.provider },
        undefined,
        { id: String(a.id) },
      ),
  },
  {
    name: "paycraft_sync_events",
    title: "Sync run events",
    description:
      "Per-provider events for a sync run. Where a summary says a provider failed, these rows say " +
      "why. Pass run_id from a sync result. Requires products:read.",
    inputSchema: obj({
      run_id: { type: "string" },
      provider: { type: "string" },
      status: { type: "string" },
      ...PAGING,
    }),
    invoke: (a, auth, origin) => call(syncEventsGET, "GET", "/api/v1/sync/events", auth, origin, a),
  },
  {
    name: "paycraft_subscribers",
    title: "List subscriptions",
    description:
      "Subscription records, filterable by email, status, provider and mode. Filter by mode when " +
      "answering a live question — a test-mode row answers a different one. Requires subscribers:read.",
    inputSchema: obj({
      email: { type: "string" },
      status: { type: "string" },
      provider: { type: "string" },
      mode: { type: "string", enum: ["test", "live"] },
      ...PAGING,
    }),
    invoke: (a, auth, origin) => call(subscribersGET, "GET", "/api/v1/subscribers", auth, origin, a),
  },
  {
    name: "paycraft_entitlements",
    title: "List entitlements",
    description:
      "What PayCraft GRANTS, as opposed to what a provider bills — the two disagree during grace " +
      "periods and refunds, and this is the one an app should trust. Requires subscribers:read.",
    inputSchema: obj({
      app_user_id: { type: "string" },
      provider: { type: "string" },
      state: { type: "string" },
      ...PAGING,
    }),
    invoke: (a, auth, origin) =>
      call(entitlementsGET, "GET", "/api/v1/entitlements", auth, origin, a),
  },
  {
    name: "paycraft_coupons",
    title: "List coupons",
    description: "Discount codes with their per-provider counterparts. Requires coupons:read.",
    inputSchema: obj({ code: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(couponsGET, "GET", "/api/v1/coupons", auth, origin, a),
  },
  {
    name: "paycraft_paywall",
    title: "Paywall configuration",
    description:
      "What the SDK renders. Useful as a snapshot to diff between deploys. Requires paywall:read.",
    inputSchema: obj({}),
    invoke: (_a, auth, origin) => call(paywallGET, "GET", "/api/v1/paywall", auth, origin),
  },
  {
    name: "paycraft_webhooks",
    title: "Inbound webhook deliveries",
    description:
      "Webhook deliveries with redacted payloads. Filter status=failed to answer whether anything " +
      "was dropped after a provider incident. Requires webhooks:read.",
    inputSchema: obj({
      provider: { type: "string" },
      status: { type: "string" },
      event_type: { type: "string" },
      mode: { type: "string", enum: ["test", "live"] },
      ...PAGING,
    }),
    invoke: (a, auth, origin) => call(webhooksGET, "GET", "/api/v1/webhooks", auth, origin, a),
  },
  {
    name: "paycraft_audit",
    title: "Audit trail",
    description:
      "Who changed what, including this API's own actions (actor_type=api_key). Requires audit:read.",
    inputSchema: obj({ action: { type: "string" }, actor_type: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(auditGET, "GET", "/api/v1/audit", auth, origin, a),
  },
]

export const TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]))
