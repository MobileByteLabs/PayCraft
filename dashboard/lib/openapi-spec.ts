/**
 * OpenAPI 3.1 description of the PayCraft management API.
 *
 * Hand-written against the ACTUAL route behaviour rather than generated from types, because the
 * parts a caller most needs — which scope each endpoint demands, why a 409 is an instruction rather
 * than a wall, that Play/App Store readiness can only ever be satisfied by a human — live in the
 * authorization layer and the database, not in a TypeScript signature.
 *
 * Kept in one module so the spec endpoint and the docs page cannot disagree about what the API is.
 */

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "PayCraft Management API",
    version: "1.0.0",
    summary: "Machine access to a PayCraft tenant: provider readiness and product sync.",
    description: [
      "Server-to-server API for automating a PayCraft tenant from CI, a deploy pipeline, or an agent.",
      "",
      "### Why it exists",
      "Every other admin surface authenticates with a browser session. Owner accounts commonly sign in",
      "with Google, which has no password, and Google refuses automated browsers outright — so before",
      "this API there was no way to run an admin operation without a human at a keyboard.",
      "",
      "### Authentication",
      "Send a secret key as a bearer token: `Authorization: Bearer pcsk_…`.",
      "",
      "The **tenant is derived from the key**, never from the request. No endpoint accepts a tenant id,",
      "in the body, the query string, or a header — a bearer credential that let the caller name the",
      "tenant would be a key to every tenant.",
      "",
      "Keys are stored only as a SHA-256 hash, so a database dump yields nothing usable and a lost key",
      "cannot be recovered — mint a new one. Create and revoke them under **Settings → Developer API**.",
      "",
      "### Scopes",
      "Each endpoint demands exactly one scope, and a key carries a closed set. A read key cannot",
      "bulk-write to live payment providers even though both sit behind the same authentication.",
      "",
      "| Scope | Grants |",
      "|---|---|",
      "| `readiness:read` | `GET /v1/readiness` |",
      "| `products:read` | `GET /v1/sync` (the drift report) |",
      "| `products:sync` | `POST /v1/sync` (bulk-writes to live providers) |",
      "| `providers:read` | `GET /v1/providers` |",
      "| `tenant:read` | `GET /v1/tenant` |",
      "| `subscribers:read` | `GET /v1/subscribers`, `GET /v1/entitlements` |",
      "| `coupons:read` | `GET /v1/coupons` |",
      "| `paywall:read` | `GET /v1/paywall` |",
      "| `webhooks:read` | `GET /v1/webhooks` |",
      "| `audit:read` | `GET /v1/audit` |",
      "",
      "### Pagination",
      "List endpoints take `limit` (1–200, default 50) and `offset`, and return a `pagination` object",
      "carrying `total` and `has_more`. An out-of-range `limit` is clamped rather than rejected.",
      "",
      "### Rate limiting",
      "A token bucket per tenant: 120 requests, refilling at 1/second. Over the limit returns `429`.",
      "",
      "### Test mode",
      "Stripe, Razorpay and other PSPs reach test readiness through a test credential plus a product",
      "sync. **Google Play and the App Store cannot** — neither store exposes an API to enable or assert",
      "test mode. Those rows carry `manual_steps` describing work a person must do on a device, and turn",
      "green only when a real sandbox purchase reaches PayCraft.",
    ].join("\n"),
    contact: { name: "PayCraft", url: "https://paycraft.mobilebytesensei.com" },
  },
  servers: [
    { url: "https://api.paycraft.mobilebytesensei.com/v1", description: "Production" },
    {
      url: "https://paycraft.mobilebytesensei.com/api/v1",
      description: "Production (same API on the dashboard host)",
    },
  ],
  tags: [
    { name: "Tenant", description: "The account this key belongs to." },
    { name: "Readiness", description: "Whether each provider can transact, per mode." },
    { name: "Catalogue", description: "Products, pricing and coupons." },
    { name: "Sync", description: "Reconcile products and payment artifacts with each provider." },
    { name: "Customers", description: "Subscriptions and entitlement state." },
    { name: "Operations", description: "Webhook deliveries and the audit trail." },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/tenant": {
      get: {
        tags: ["Tenant"],
        operationId: "getTenant",
        summary: "The account this key belongs to",
        description: "Plan, subscriber limit and the calling key's own scopes — a credential that describes itself.",
        security: [{ bearerAuth: ["tenant:read"] }],
        responses: {
          "200": { description: "Tenant metadata plus the calling key's scopes.", content: { "application/json": { schema: { type: "object" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/products": {
      get: {
        tags: ["Catalogue"],
        operationId: "listProducts",
        summary: "The product catalogue",
        description: "Each row carries the provider ids the product synced to, so one call answers whether it landed at Stripe, Play and the App Store.",
        security: [{ bearerAuth: ["products:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "sku", in: "query", required: false, schema: { type: "string" },
            description: "Filter by sku.",
          },
          {
            name: "type", in: "query", required: false, schema: { type: "string" },
            description: "Filter by type.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/products/{id}": {
      get: {
        tags: ["Catalogue"],
        operationId: "getProduct",
        summary: "One product, with pricing rows",
        security: [{ bearerAuth: ["products:read"] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "The product and its per-currency pricing.", content: { "application/json": { schema: { type: "object" } } } },
          "404": { description: "No such product on this tenant.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/products/{id}/sync": {
      post: {
        tags: ["Sync"],
        operationId: "syncProduct",
        summary: "Push one product to its providers",
        description: "The scoped counterpart to POST /v1/sync. No confirm_count: this names its single subject in the URL, so there is no unenumerated set to confirm. Optional `provider` narrows it further.",
        security: [{ bearerAuth: ["products:sync"] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "provider", in: "query", required: false, schema: { type: "string", enum: ["stripe","razorpay","cashfree","google_play","app_store"] } },
        ],
        responses: {
          "200": { description: "Per-provider verdicts. Inspect them — a provider can fail while the call succeeds.", content: { "application/json": { schema: { type: "object" } } } },
          "404": { description: "No such product on this tenant.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/providers": {
      get: {
        tags: ["Readiness"],
        operationId: "listProviders",
        summary: "Connected providers",
        description: "Connections and their payment-link maps. Never credentials — there is no endpoint that decrypts a provider secret.",
        security: [{ bearerAuth: ["providers:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "provider", in: "query", required: false, schema: { type: "string" },
            description: "Filter by provider.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/sync/events": {
      get: {
        tags: ["Sync"],
        operationId: "listSyncEvents",
        summary: "Per-provider events for a run",
        description: "Pass run_id from a sync response. Where the summary says a provider failed, these rows say why.",
        security: [{ bearerAuth: ["products:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "run_id", in: "query", required: false, schema: { type: "string" },
            description: "Filter by run_id.",
          },
          {
            name: "provider", in: "query", required: false, schema: { type: "string" },
            description: "Filter by provider.",
          },
          {
            name: "status", in: "query", required: false, schema: { type: "string" },
            description: "Filter by status.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/subscribers": {
      get: {
        tags: ["Customers"],
        operationId: "listSubscribers",
        summary: "Subscription records",
        description: "Filterable by mode, so a live question is not answered by a test-mode row.",
        security: [{ bearerAuth: ["subscribers:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "email", in: "query", required: false, schema: { type: "string" },
            description: "Filter by email.",
          },
          {
            name: "status", in: "query", required: false, schema: { type: "string" },
            description: "Filter by status.",
          },
          {
            name: "provider", in: "query", required: false, schema: { type: "string" },
            description: "Filter by provider.",
          },
          {
            name: "mode", in: "query", required: false, schema: { type: "string" },
            description: "Filter by mode.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/entitlements": {
      get: {
        tags: ["Customers"],
        operationId: "listEntitlements",
        summary: "Canonical entitlement state",
        description: "What PayCraft grants, as opposed to what a provider bills. The two disagree during grace periods and refunds; this is the one an app should trust. `is_sandbox` is also the evidence that turns store test readiness green.",
        security: [{ bearerAuth: ["subscribers:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "app_user_id", in: "query", required: false, schema: { type: "string" },
            description: "Filter by app_user_id.",
          },
          {
            name: "provider", in: "query", required: false, schema: { type: "string" },
            description: "Filter by provider.",
          },
          {
            name: "state", in: "query", required: false, schema: { type: "string" },
            description: "Filter by state.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/coupons": {
      get: {
        tags: ["Catalogue"],
        operationId: "listCoupons",
        summary: "Discount codes",
        description: "Codes with their per-provider counterparts (Stripe coupon, Razorpay offer, store offer ids).",
        security: [{ bearerAuth: ["coupons:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "code", in: "query", required: false, schema: { type: "string" },
            description: "Filter by code.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/paywall": {
      get: {
        tags: ["Catalogue"],
        operationId: "getPaywall",
        summary: "Paywall configuration",
        description: "What the SDK renders. Useful as a CI snapshot: diff it between deploys and an unintended change fails a check instead of reaching customers.",
        security: [{ bearerAuth: ["paywall:read"] }],
        responses: {
          "200": { description: "The paywall configuration.", content: { "application/json": { schema: { type: "object" } } } },
          "404": { description: "No paywall configured.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["Operations"],
        operationId: "listWebhooks",
        summary: "Inbound webhook deliveries",
        description: "Payloads are stored redacted, so this cannot leak customer or card detail. Filter status=failed to answer whether anything was dropped.",
        security: [{ bearerAuth: ["webhooks:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "provider", in: "query", required: false, schema: { type: "string" },
            description: "Filter by provider.",
          },
          {
            name: "status", in: "query", required: false, schema: { type: "string" },
            description: "Filter by status.",
          },
          {
            name: "event_type", in: "query", required: false, schema: { type: "string" },
            description: "Filter by event_type.",
          },
          {
            name: "mode", in: "query", required: false, schema: { type: "string" },
            description: "Filter by mode.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/audit": {
      get: {
        tags: ["Operations"],
        operationId: "listAudit",
        summary: "Audit trail",
        description: "Includes this API's own actions (actor_type = api_key), so a key's activity is auditable by the same mechanism it uses to act.",
        security: [{ bearerAuth: ["audit:read"] }],
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/offset" },
          {
            name: "action", in: "query", required: false, schema: { type: "string" },
            description: "Filter by action.",
          },
          {
            name: "actor_type", in: "query", required: false, schema: { type: "string" },
            description: "Filter by actor_type.",
          },
        ],
        responses: {
          "200": {
            description: "A page of results.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PagedResponse" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/readiness": {
      get: {
        tags: ["Readiness"],
        operationId: "getReadiness",
        summary: "Per-provider, per-mode readiness",
        description: [
          "Answers the question a deploy pipeline actually has: *can this app transact in test mode yet,",
          "and if not, what is missing?*",
          "",
          "Credentials are account-level — an app does not own a provider credential, it shares one — so",
          "key presence is resolved from the shared connection, while payment links and plans stay",
          "app-scoped.",
          "",
          "Rows that need human work carry `manual_steps` and `console_url`. `summary.needs_manual_action`",
          "counts them so a caller can branch without inspecting every row.",
        ].join("\n"),
        security: [{ bearerAuth: ["readiness:read"] }],
        responses: {
          "200": {
            description: "Readiness for every provider configured on the tenant.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReadinessResponse" },
                examples: {
                  mixed: {
                    summary: "PSPs green, stores awaiting a sandbox purchase",
                    value: {
                      tenant_id: "ba973ad0-8788-4c0f-89c8-1ff9533fa79f",
                      providers: [
                        {
                          provider: "stripe",
                          auth_kind: "key_pair",
                          is_active: true,
                          live_ready: true,
                          test_ready: true,
                          live_detail: "live key pk_live_51R…aVcn, 3 payment link(s)",
                          test_detail: "test key pk_test_51R…lnau, 21 payment link(s)",
                          test_mechanism: "test_api_key",
                          human_action: null,
                          manual_steps: null,
                          console_url: "https://dashboard.stripe.com/test/apikeys",
                        },
                        {
                          provider: "google_play",
                          auth_kind: "store",
                          is_active: true,
                          live_ready: true,
                          test_ready: false,
                          live_detail: "store credential attached",
                          test_detail:
                            "not yet proven — no sandbox purchase has reached PayCraft for this provider",
                          test_mechanism: "license_tester",
                          human_action:
                            "Play Console → Setup → License testing: add a tester Google account…",
                          manual_steps: [
                            "Play Console → your app → Setup → License testing",
                            "Add the tester's Google account under \"License testers\" and save",
                            "Testing → Internal testing → Testers: make sure that same account is on the track",
                            "On the device, sign in to Google Play with that account",
                            "Install the app FROM THE PLAY TRACK — license testing only applies to Play-delivered builds",
                            "Open the paywall and buy. A license tester is charged nothing",
                            "This row turns green automatically when that purchase reaches PayCraft",
                          ],
                          console_url: "https://play.google.com/console",
                        },
                      ],
                      summary: { total: 4, needs_manual_action: 2, live_ready: 4, test_ready: 2 },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/sync": {
      get: {
        tags: ["Sync"],
        operationId: "getSyncDrift",
        summary: "Drift report — what a sync would do",
        description: [
          "Read-only. Returns every divergence between PayCraft and its providers, plus the",
          "`confirm_count` that `POST /v1/sync` requires.",
          "",
          "Call this first. The count you echo back is how the API knows you acted on a set someone",
          "actually saw.",
        ].join("\n"),
        security: [{ bearerAuth: ["products:read"] }],
        responses: {
          "200": {
            description: "The current drift set.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DriftResponse" },
                examples: {
                  converged: {
                    summary: "Nothing to do",
                    value: { tenant_id: "ba97…", confirm_count: 0, findings: [] },
                  },
                  pending: {
                    summary: "A provider is missing its test artifacts",
                    value: {
                      tenant_id: "ba97…",
                      confirm_count: 1,
                      findings: [{ kind: "test-links-missing", subject: "provider:stripe" }],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": { $ref: "#/components/responses/DriftIncomplete" },
        },
      },
      post: {
        tags: ["Sync"],
        operationId: "runSync",
        summary: "Run the sync drain",
        description: [
          "**Bulk-writes to live payment providers.** Creates and updates products, prices, payment",
          "links and subscription plans in every configured mode.",
          "",
          "Gated on `confirm_count`, which must equal the count from `GET /v1/sync`. A mismatch returns",
          "`409` rather than proceeding: the world changed between looking and acting, which is exactly",
          "when a bulk write to a billing provider should stop and ask again. The gate is kept for",
          "machine callers deliberately — nobody watching is when a mismatched count matters most.",
          "",
          "Idempotent in effect: a second run with nothing to do reports `synced: 0`.",
        ].join("\n"),
        security: [{ bearerAuth: ["products:sync"] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SyncRequest" },
              example: { confirm_count: 2 },
            },
          },
        },
        responses: {
          "200": {
            description:
              "The drain ran. Inspect `failed` and `skipped` — a 200 does not mean every provider succeeded.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SyncResponse" },
                example: {
                  ok: true,
                  synced: 6,
                  priced_locales: 0,
                  skipped: [],
                  failed: [],
                  needs_human: [],
                  run_id: "9d780927-5974-43a0-bf6f-4e9e721ed2a3",
                },
              },
            },
          },
          "400": {
            description: "Malformed request body.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "409": {
            description:
              "`confirm_count` does not match the current drift set. Re-read `GET /v1/sync` and retry with the new count.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CountMismatch" },
                example: {
                  error: "count_mismatch",
                  expected: 3,
                  received: 2,
                  detail:
                    "The drift set changed — 3 item(s) now need attention. Re-read the report and confirm again.",
                  requiresConfirmation: true,
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": { $ref: "#/components/responses/DriftIncomplete" },
        },
      },
    },
  },
  components: {
    parameters: {
      limit: {
        name: "limit", in: "query", required: false,
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        description: "Page size. Values above 200 are clamped, not rejected.",
      },
      offset: {
        name: "offset", in: "query", required: false,
        schema: { type: "integer", minimum: 0, default: 0 },
        description: "Rows to skip.",
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "A PayCraft secret key (`pcsk_…`). Create one under Settings → Developer API. Shown once at creation and stored only as a hash.",
      },
    },
    responses: {
      Unauthorized: {
        description:
          "Missing, malformed, unknown, revoked or expired key. All four are reported identically — distinguishing them would tell an attacker which guess was once real.",
        headers: {
          "WWW-Authenticate": { schema: { type: "string" }, description: 'Bearer realm="paycraft"' },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "invalid_api_key" },
          },
        },
      },
      Forbidden: {
        description:
          "The key is valid but lacks the required scope. Retrying with the same key will never succeed.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "insufficient_scope", detail: "this key does not carry 'products:sync'" },
          },
        },
      },
      RateLimited: {
        description: "Token bucket exhausted (120 requests, refilling at 1/second, per tenant).",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "rate_limited" },
          },
        },
      },
      DriftIncomplete: {
        description:
          "A provider was unreachable, so the true count is unknown. The API refuses rather than draining a partial set — an unknown count is not a zero count.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "drift_incomplete", detail: "a provider was unreachable" },
          },
        },
      },
      ServerError: {
        description: "Server-side failure. The response names the misconfigured variable where it can.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "server_misconfigured", detail: "SUPABASE_SERVICE_ROLE_KEY is not set" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", description: "Stable machine-readable code." },
          detail: { type: "string", description: "Human-readable elaboration, when one helps." },
        },
      },
      CountMismatch: {
        allOf: [
          { $ref: "#/components/schemas/Error" },
          {
            type: "object",
            properties: {
              expected: { type: "integer", description: "The count the server sees now." },
              received: { type: ["integer", "null"], description: "The count you sent." },
              requiresConfirmation: { type: "boolean" },
            },
          },
        ],
      },
      PagedResponse: {
        type: "object",
        properties: {
          data: { type: "array", items: { type: "object" } },
          pagination: {
            type: "object",
            properties: {
              limit: { type: "integer" },
              offset: { type: "integer" },
              total: { type: ["integer", "null"] },
              has_more: { type: "boolean" },
            },
          },
        },
      },
      ProviderReadiness: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            examples: ["stripe", "razorpay", "cashfree", "google_play", "app_store"],
          },
          auth_kind: {
            type: "string",
            enum: ["key_pair", "store"],
            description: "`store` providers are proven by evidence, not by configuration.",
          },
          is_active: { type: "boolean" },
          live_ready: { type: "boolean" },
          test_ready: { type: "boolean" },
          live_detail: { type: "string", description: "Why live_ready is what it is." },
          test_detail: { type: "string", description: "Why test_ready is what it is." },
          test_mechanism: {
            type: "string",
            enum: ["test_api_key", "license_tester", "sandbox_apple_id"],
            description: "How test mode is reached for this provider.",
          },
          human_action: {
            type: ["string", "null"],
            description: "One-line summary of the outstanding work. Null when the row is green.",
          },
          manual_steps: {
            type: ["array", "null"],
            items: { type: "string" },
            description:
              "Ordered steps for work no API can perform. Present only where a person must act.",
          },
          console_url: {
            type: ["string", "null"],
            format: "uri",
            description: "Where that work happens.",
          },
        },
      },
      ReadinessResponse: {
        type: "object",
        properties: {
          tenant_id: { type: "string", format: "uuid", description: "Derived from the key." },
          providers: { type: "array", items: { $ref: "#/components/schemas/ProviderReadiness" } },
          summary: {
            type: "object",
            properties: {
              total: { type: "integer" },
              needs_manual_action: {
                type: "integer",
                description: "Providers whose next step requires a person.",
              },
              live_ready: { type: "integer" },
              test_ready: { type: "integer" },
            },
          },
        },
      },
      DriftFinding: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "product-missing-at-provider",
              "paywall-not-published",
              "credential-mode-mismatch",
              "active-provider-no-credential",
              "no-test-credential",
              "test-links-missing",
              "active-provider-zero-links",
              "missing-currency-for-country",
            ],
          },
          subject: { type: "string", examples: ["provider:stripe", "product:cappy_plus_monthly"] },
        },
      },
      DriftResponse: {
        type: "object",
        properties: {
          tenant_id: { type: "string", format: "uuid" },
          confirm_count: {
            type: "integer",
            description: "Echo this back in POST /v1/sync.",
          },
          findings: { type: "array", items: { $ref: "#/components/schemas/DriftFinding" } },
        },
      },
      SyncRequest: {
        type: "object",
        required: ["confirm_count"],
        properties: {
          confirm_count: {
            type: "integer",
            minimum: 0,
            description: "Must equal the count from GET /v1/sync.",
          },
        },
      },
      SyncOutcome: {
        type: "object",
        properties: {
          subject: { type: "string" },
          ok: { type: "boolean" },
          skipped: { type: "boolean" },
          detail: { type: "string" },
        },
      },
      SyncResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          synced: { type: "integer", description: "Product/provider pairs written." },
          priced_locales: { type: "integer" },
          skipped: {
            type: "array",
            items: { $ref: "#/components/schemas/SyncOutcome" },
            description: "Not a success. A provider that could not be used, with the reason.",
          },
          failed: { type: "array", items: { $ref: "#/components/schemas/SyncOutcome" } },
          needs_human: {
            type: "array",
            items: { $ref: "#/components/schemas/DriftFinding" },
            description: "Findings no automated drain can close.",
          },
          run_id: {
            type: "string",
            format: "uuid",
            description: "Correlation id. Every per-provider event is recorded against it.",
          },
        },
      },
    },
  },
} as const
