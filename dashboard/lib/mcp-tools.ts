import { GET as readinessGET } from "@/app/api/v1/readiness/route"
import { GET as syncGET, POST as syncPOST } from "@/app/api/v1/sync/route"
import { GET as productsGET, POST as productsPOST } from "@/app/api/v1/products/route"
import { GET as productGET, PATCH as productPATCH } from "@/app/api/v1/products/[id]/route"
import { POST as productSyncPOST } from "@/app/api/v1/products/[id]/sync/route"
import { PUT as productPricingPUT } from "@/app/api/v1/products/[id]/pricing/route"
import { POST as productRetirePOST } from "@/app/api/v1/products/[id]/retire/route"
import { GET as providersGET, POST as providersPOST } from "@/app/api/v1/providers/route"
import { GET as providerAccountsGET } from "@/app/api/v1/provider-accounts/route"
import { GET as appsGET, POST as appsPOST } from "@/app/api/v1/apps/route"
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
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  auth: string,
  origin: string,
  query?: Record<string, unknown>,
  body?: unknown,
  routeParams?: Record<string, string>,
): Promise<Response> {
  // `origin` MAY carry query params (the dispatcher puts `tenant_id` there so every tool forwards
  // it without each invoke having to remember). They must be copied explicitly: `new URL(path,
  // base)` keeps only the base's ORIGIN and silently drops its query, so appending to the origin
  // string alone would have looked right and sent nothing.
  const base = new URL(origin)
  const url = new URL(path, base.origin)
  base.searchParams.forEach((v, k) => url.searchParams.set(k, v))
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

/**
 * Every tool takes an optional `tenant_id`.
 *
 * An APP-scoped token ignores it (naming a different app is refused), so single-app users never
 * need it. An ACCOUNT-scoped token (migration 150) reaches several apps and therefore REQUIRES it:
 * the API answers 400 `tenant_required` rather than picking one, so an agent is told which
 * question it failed to ask instead of acting on an arbitrary app. Use `paycraft_apps` to list
 * what the token reaches.
 */
const TENANT = {
  tenant_id: {
    type: "string",
    description:
      "Which app to act on. Required for account-scoped tokens (they reach several apps); " +
      "ignored by app-scoped tokens. List reachable apps with paycraft_apps.",
  },
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
    inputSchema: obj({ ...TENANT }),
    invoke: (_a, auth, origin) => call(readinessGET, "GET", "/api/v1/readiness", auth, origin),
  },
  {
    name: "paycraft_tenant",
    title: "Tenant and key info",
    description:
      "The account this key belongs to: plan, subscriber limit, and the calling key's own scopes. " +
      "Useful first call to discover what this credential is permitted to do. Requires tenant:read.",
    inputSchema: obj({ ...TENANT }),
    invoke: (_a, auth, origin) => call(tenantGET, "GET", "/api/v1/tenant", auth, origin),
  },
  {
    name: "paycraft_products",
    title: "List products",
    description:
      "The product catalogue with each provider's synced ids, so one call answers whether a product " +
      "landed at Stripe, Play and the App Store. Requires products:read.",
    inputSchema: obj({ ...TENANT, sku: { type: "string" }, type: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(productsGET, "GET", "/api/v1/products", auth, origin, a),
  },
  {
    name: "paycraft_product",
    title: "Get one product",
    description: "One product with its per-currency pricing rows. Requires products:read.",
    inputSchema: obj({ ...TENANT, id: { type: "string", description: "Product UUID." } }, ["id"]),
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
    inputSchema: obj({ ...TENANT, provider: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(providersGET, "GET", "/api/v1/providers", auth, origin, a),
  },
  {
    name: "paycraft_sync_report",
    title: "Drift report (read-only)",
    description:
      "What a sync WOULD change, plus the confirm_count that paycraft_sync_run requires. Always call " +
      "this before running a sync — the count is how the API knows you acted on a set someone saw. " +
      "Requires products:read.",
    inputSchema: obj({ ...TENANT }),
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
      { ...TENANT,
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
    name: "paycraft_create_product",
    title: "Create a catalogue product",
    description:
      "Adds a product to the catalogue. This is the CREATE half of onboarding: without it a fresh " +
      "app could only be given a catalogue by calling the database directly, which is how the " +
      "product set ends up outside the API's scopes and audit log. Refuses a SKU that already " +
      "exists (409) unless upsert:true, because the underlying write is an upsert on (tenant, sku) " +
      "and a live SKU may already be synced to three storefronts. Writes PayCraft only — nothing " +
      "reaches a store until paycraft_sync_product. Requires products:write.",
    inputSchema: obj(
      {
        ...TENANT,
        sku: { type: "string", description: "Stable catalogue id, unique per app. Immutable afterwards." },
        display_name: { type: "string", description: "Customer-facing name, e.g. \"Cappy Weekly\"." },
        interval: {
          type: "string",
          enum: ["week", "month", "quarter", "semiannual", "year"],
          description: "Billing cadence. Required for a subscription.",
        },
        type: { type: "string", enum: ["subscription", "one_time", "consumable"], description: "Default: subscription." },
        base_price_cents: { type: "integer", minimum: 0, description: "Reference price in MINOR units. Per-country prices go through paycraft_set_product_pricing." },
        base_currency: { type: "string", description: "ISO 4217 for base_price_cents. Default USD." },
        trial_enabled: { type: "boolean" },
        trial_duration_days: { type: "integer", minimum: 0, maximum: 365, description: "Free-trial length applied to every platform." },
        trial_per_platform: {
          type: ["object", "null"],
          description:
            "PER-PLATFORM trial override ({android,ios,web,desktop} -> days). It BEATS " +
            "trial_duration_days whenever non-empty, so a stale entry makes the product serve a " +
            "trial length its own catalogue disowns. Send null to clear it.",
        },
        active: { type: "boolean", description: "Stop SELLING with paycraft_retire_product instead — it stops the storefronts first." },
        display_order: { type: "integer" },
        pricing_mode: { type: "string", enum: ["auto", "global", "manual"] },
        discount_percent: { type: "integer", minimum: 0, maximum: 100 },
        upsert: { type: "boolean", description: "Update the product if this SKU already exists, instead of 409." },
      },
      ["sku", "display_name"],
    ),
    invoke: (a, auth, origin) => {
      const { tenant_id: _t, ...body } = a
      return call(productsPOST, "POST", "/api/v1/products", auth, origin, undefined, body)
    },
  },
  {
    name: "paycraft_update_product",
    title: "Update a product's catalogue fields",
    description:
      "Changes named fields on one product and leaves everything else exactly as it was. The " +
      "underlying upsert overwrites twenty columns, so this reads the current row and merges " +
      "server-side; store ids are preserved rather than nulled. sku is immutable (it is the " +
      "conflict key — changing it would create a SECOND product and leave this one sellable). " +
      "Send trial_per_platform:null to clear a per-platform trial override. Catalogue only: the " +
      "storefronts keep serving the old values until paycraft_sync_product runs, and the response " +
      "says so. Requires products:write.",
    inputSchema: obj(
      {
        ...TENANT,
        id: { type: "string", description: "Product UUID." },
        display_name: { type: "string", description: "Customer-facing name, e.g. \"Cappy Weekly\"." },
        interval: {
          type: "string",
          enum: ["week", "month", "quarter", "semiannual", "year"],
          description: "Billing cadence. Required for a subscription.",
        },
        type: { type: "string", enum: ["subscription", "one_time", "consumable"], description: "Default: subscription." },
        base_price_cents: { type: "integer", minimum: 0, description: "Reference price in MINOR units. Per-country prices go through paycraft_set_product_pricing." },
        base_currency: { type: "string", description: "ISO 4217 for base_price_cents. Default USD." },
        trial_enabled: { type: "boolean" },
        trial_duration_days: { type: "integer", minimum: 0, maximum: 365, description: "Free-trial length applied to every platform." },
        trial_per_platform: {
          type: ["object", "null"],
          description:
            "PER-PLATFORM trial override ({android,ios,web,desktop} -> days). It BEATS " +
            "trial_duration_days whenever non-empty, so a stale entry makes the product serve a " +
            "trial length its own catalogue disowns. Send null to clear it.",
        },
        active: { type: "boolean", description: "Stop SELLING with paycraft_retire_product instead — it stops the storefronts first." },
        display_order: { type: "integer" },
        pricing_mode: { type: "string", enum: ["auto", "global", "manual"] },
        discount_percent: { type: "integer", minimum: 0, maximum: 100 },
      },
      ["id"],
    ),
    invoke: (a, auth, origin) => {
      const { tenant_id: _t, id, ...body } = a
      return call(productPATCH, "PATCH", `/api/v1/products/${id}`, auth, origin, undefined, body, {
        id: String(id),
      })
    },
  },
  {
    name: "paycraft_apps",
    title: "List the apps this key reaches",
    description:
      "Every app the calling key can act on, with the one currently selected. START HERE with an " +
      "account-scoped key: every other tool needs a tenant_id, and before this existed the only " +
      "way to learn one was to trigger the tenant_required error and read the ids out of its " +
      "message. Requires apps:read.",
    inputSchema: obj({ ...TENANT }),
    invoke: (_a, auth, origin) => call(appsGET, "GET", "/api/v1/apps", auth, origin),
  },
  {
    name: "paycraft_create_app",
    title: "Create an app (account-scoped keys only)",
    description:
      "Provisions a new app under this account and returns its PUBLISHABLE key (pk_…, the one " +
      "that ships in the client). Idempotent per (account, app_name) — re-running returns the " +
      "existing app with created:false, so an interrupted onboarding chain is safe to retry. " +
      "Refused for an app-scoped key: creating siblings is account-level reach. Requires apps:write.",
    inputSchema: obj(
      {
        ...TENANT,
        app_name: { type: "string", description: "Display name, e.g. \"Cappy\"." },
        app_identifier: {
          type: "string",
          description:
            "The app's STABLE id (Android applicationId / iOS bundle id, e.g. com.acme.app). " +
            "Strongly recommended: it is the key reuse matches on, so passing it makes re-runs " +
            "exact instead of depending on the display name, which drifts in case and wording.",
        },
      },
      ["app_name"],
    ),
    invoke: (a, auth, origin) => {
      const { tenant_id: _t, ...body } = a
      return call(appsPOST, "POST", "/api/v1/apps", auth, origin, undefined, body)
    },
  },
  {
    name: "paycraft_provider_accounts",
    title: "List attachable provider credentials",
    description:
      "The provider credentials this app CAN attach to, with which one is default and whether each " +
      "is already wired here. Call this before paycraft_attach_provider so 'connect Stripe' has an " +
      "answer to 'which Stripe?' — otherwise the only way to see the candidates is to attempt an " +
      "attach and read them out of the 400. Credentials are masked to has_credential; no endpoint " +
      "returns a provider secret. Empty means the account holds no connection for that provider — " +
      "someone must add it in the dashboard first, which is the one onboarding step no API does. " +
      "Requires providers:read.",
    inputSchema: obj({ ...TENANT, provider: { type: "string", description: "Filter, e.g. stripe. Omit for all." } }),
    invoke: (a, auth, origin) =>
      call(providerAccountsGET, "GET", "/api/v1/provider-accounts", auth, origin, a),
  },
  {
    name: "paycraft_attach_provider",
    title: "Attach a payment provider to this app",
    description:
      "Points the app at a provider credential the ACCOUNT already holds. NO SECRET TRAVELS: you " +
      "name an account_id (or omit it to take the account's default connection), never a key — " +
      "provider secrets stay encrypted server-side and are read only by the sync. Credentials are " +
      "added once, in the dashboard; every app thereafter just attaches. Attaching selects a " +
      "credential, it does not prove the provider can transact — read paycraft_readiness after. " +
      "Requires providers:write.",
    inputSchema: obj(
      {
        ...TENANT,
        provider: {
          type: "string",
          description: "stripe | razorpay | google_play | app_store | paddle | lemonsqueezy | paypal | paystack | flutterwave | cashfree | midtrans | btcpay",
        },
        account_id: { type: "string", description: "Which account connection to use. Omit for the account's default." },
        package_name: { type: "string", description: "google_play only — this APP's Android package." },
        bundle_id: { type: "string", description: "app_store only — this APP's iOS bundle id." },
      },
      ["provider"],
    ),
    invoke: (a, auth, origin) => {
      const { tenant_id: _t, ...body } = a
      return call(providersPOST, "POST", "/api/v1/providers", auth, origin, undefined, body)
    },
  },
  {
    name: "paycraft_set_product_pricing",
    title: "Set a product's per-locale prices",
    description:
      "Writes this product's per-country prices. UPSERT per locale: an omitted locale keeps its " +
      "current price, so this can never silently un-price a live region. Does NOT reach any store " +
      "— call paycraft_sync_product afterwards to push them, and read its per-provider verdicts. " +
      "A product with no rows here syncs with its base currency ALONE, which is how a subscription " +
      "reaches Google Play priced in one region and is unbuyable everywhere else. Requires " +
      "products:write.",
    inputSchema: obj(
      {
        ...TENANT,
        id: { type: "string", description: "Product UUID." },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          description:
            "One row per country. amount_cents is MINOR units (₹89.99 → 8999). Zero-decimal " +
            "currencies (JPY, KRW, …) are refused: the minor-unit convention is ambiguous for them " +
            "and a 100x error here becomes a live store price.",
          items: {
            type: "object",
            properties: {
              locale: { type: "string", description: "ISO 3166-1 alpha-2 country, e.g. IN." },
              currency: { type: "string", description: "ISO 4217, e.g. INR." },
              amount_cents: { type: "integer", minimum: 1 },
            },
            required: ["locale", "currency", "amount_cents"],
          },
        },
      },
      ["id", "rows"],
    ),
    // Not `destructive`: this writes PayCraft's own catalogue, never a payment provider. The
    // destructive flag is reserved for tools that reach a live store, so marking this one would
    // blunt the signal on the tool that actually charges people.
    invoke: (a, auth, origin) =>
      call(
        productPricingPUT,
        "PUT",
        `/api/v1/products/${a.id}/pricing`,
        auth,
        origin,
        undefined,
        { rows: a.rows },
        { id: String(a.id) },
      ),
  },
  {
    name: "paycraft_sync_product",
    title: "Sync one product (writes to live providers)",
    description:
      "Pushes a single product to its providers. No confirm_count — the subject is named explicitly. " +
      "Optionally narrow to one provider. Requires products:sync.",
    inputSchema: obj(
      { ...TENANT,
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
    name: "paycraft_retire_product",
    title: "Retire a product (stops sales at the live stores)",
    description:
      "Stops a product being sold: deactivates its base plans at each connected store, then marks " +
      "the PayCraft row inactive — PROVIDERS FIRST, because a row flipped inactive first drops out " +
      "of every sync and the storefront is never told (that is how a retired plan stayed on sale). " +
      "Deactivate, never delete: existing subscribers keep renewing, as the stores require. " +
      "REFUSES with 409 when the product has active/trialing/past_due subscribers — stopping sales " +
      "on a live cohort is the operator's call. Requires products:write.",
    inputSchema: obj({ ...TENANT, id: { type: "string", description: "Product UUID." } }, ["id"]),
    destructive: true,
    invoke: (a, auth, origin) =>
      call(
        productRetirePOST,
        "POST",
        `/api/v1/products/${a.id}/retire`,
        auth,
        origin,
        undefined,
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
    inputSchema: obj({ ...TENANT,
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
    inputSchema: obj({ ...TENANT,
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
    inputSchema: obj({ ...TENANT,
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
    inputSchema: obj({ ...TENANT, code: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(couponsGET, "GET", "/api/v1/coupons", auth, origin, a),
  },
  {
    name: "paycraft_paywall",
    title: "Paywall configuration",
    description:
      "What the SDK renders. Useful as a snapshot to diff between deploys. Requires paywall:read.",
    inputSchema: obj({ ...TENANT }),
    invoke: (_a, auth, origin) => call(paywallGET, "GET", "/api/v1/paywall", auth, origin),
  },
  {
    name: "paycraft_webhooks",
    title: "Inbound webhook deliveries",
    description:
      "Webhook deliveries with redacted payloads. Filter status=failed to answer whether anything " +
      "was dropped after a provider incident. Requires webhooks:read.",
    inputSchema: obj({ ...TENANT,
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
    inputSchema: obj({ ...TENANT, action: { type: "string" }, actor_type: { type: "string" }, ...PAGING }),
    invoke: (a, auth, origin) => call(auditGET, "GET", "/api/v1/audit", auth, origin, a),
  },
]

export const TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]))
