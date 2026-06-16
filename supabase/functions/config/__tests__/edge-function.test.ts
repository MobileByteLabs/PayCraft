// supabase/functions/config/__tests__/edge-function.test.ts
// Phase 3 (country-pricing-template) AC-13: the /config Edge Function MUST resolve
// `Accept-Language` -> tenant_pricing row in the correct currency, with a graceful
// fallback to USD when the header is missing/malformed or the country has no row.
//
// Also covers AC-8 (global pricing mode bypasses tenant_pricing lookup) and the
// auto/manual mode tenant_pricing path.
//
// Strategy:
//   * Set CONFIG_SKIP_SERVE=1 BEFORE importing index.ts so the module-level
//     serve() registration is skipped (no port bind). The handler is exported as
//     `handleConfigRequest` for direct call.
//   * Stub globalThis.fetch so the supabase-js client's HTTP calls (resolve_tenant,
//     rate_limit_check, tenant_products_list, tenant_paywall_get, tenant_providers,
//     tenants, tenant_pricing_resolve) are intercepted.
//
// Run:
//   deno test --allow-env --allow-net \
//     supabase/functions/config/__tests__/edge-function.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Env vars MUST be set before importing index.ts. Static ES module imports are
// hoisted, so we use top-level dynamic import after the env-set calls.
Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
Deno.env.set("CONFIG_SKIP_SERVE", "1");

const { handleConfigRequest: handler } = await import("../index.ts");

// ──────────────────────────────────────────────────────────────────────────────
// Fetch stub — answers every supabase REST/RPC call the handler can make.

interface StubProduct {
  id: string;
  name: string;
  pricing_mode: "auto" | "manual" | "global";
  base_price_cents: number;
  base_currency: string;
  global_price_cents?: number | null;
  global_currency?: string | null;
}

interface StubOpts {
  tenantId?: string;
  products?: StubProduct[];
  // RPC tenant_pricing_resolve returns rows keyed by [product_id, locale].
  // Each row: { amount_cents, currency, source }
  pricingByProductLocale?: Record<
    string, // `${product_id}::${locale}`
    { amount_cents: number; currency: string; source: string } | null
  >;
  paywall?: { template?: string; branding?: string } | null;
  providers?: Array<{
    provider: string;
    supported_locales?: string[] | null;
  }>;
  tenantRow?: { plan: string; entitlements: string[] } | null;
  rateLimitOk?: boolean;
}

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

function installFetchStub(
  opts: StubOpts,
): { calls: CapturedCall[]; restore: () => void } {
  const calls: CapturedCall[] = [];
  const originalFetch = globalThis.fetch;

  const tenantId = opts.tenantId ?? "11111111-1111-1111-1111-111111111111";
  const products = opts.products ?? [];
  const pricingByProductLocale = opts.pricingByProductLocale ?? {};
  const paywall = opts.paywall === undefined
    ? { template: "minimal", branding: "attribution" }
    : opts.paywall;
  const providers = opts.providers ?? [];
  const tenantRow = opts.tenantRow === undefined
    ? { plan: "free", entitlements: [] }
    : opts.tenantRow;
  const rateLimitOk = opts.rateLimitOk ?? true;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    // deno-lint-ignore no-explicit-any
    const url = typeof input === "string" ? input : (input as any).url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    // RPC: resolve_tenant
    if (url.includes("/rest/v1/rpc/resolve_tenant")) {
      return new Response(JSON.stringify(tenantId), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // RPC: rate_limit_check — returns boolean
    if (url.includes("/rest/v1/rpc/rate_limit_check")) {
      return new Response(JSON.stringify(rateLimitOk), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // RPC: tenant_products_list
    if (url.includes("/rest/v1/rpc/tenant_products_list")) {
      return new Response(JSON.stringify(products), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // RPC: tenant_paywall_get
    if (url.includes("/rest/v1/rpc/tenant_paywall_get")) {
      return new Response(JSON.stringify(paywall), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // RPC: tenant_pricing_resolve
    if (url.includes("/rest/v1/rpc/tenant_pricing_resolve")) {
      // body is { p_tenant_id, p_product_id, p_locale }
      // deno-lint-ignore no-explicit-any
      const b = body as any;
      const key = `${b.p_product_id}::${b.p_locale}`;
      const row = pricingByProductLocale[key];
      return new Response(JSON.stringify(row ? [row] : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // REST: tenants?select=plan,entitlements&id=eq.<tenantId>  -> .single()
    if (url.includes("/rest/v1/tenants")) {
      return new Response(JSON.stringify(tenantRow), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // REST: tenant_providers
    if (url.includes("/rest/v1/tenant_providers")) {
      return new Response(JSON.stringify(providers), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Fallback empty success
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function buildRequest(opts: { acceptLanguage?: string | null } = {}): Request {
  const headers = new Headers();
  if (opts.acceptLanguage !== undefined && opts.acceptLanguage !== null) {
    headers.set("accept-language", opts.acceptLanguage);
  }
  return new Request("https://test.local/functions/v1/config?apiKey=pk_test_xyz", {
    method: "GET",
    headers,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "AC-13: Accept-Language en-US -> USD pricing row",
  async fn() {
    const productId = "p1";
    const { restore } = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "auto",
        base_price_cents: 999,
        base_currency: "USD",
      }],
      pricingByProductLocale: {
        [`${productId}::US`]: {
          amount_cents: 999,
          currency: "USD",
          source: "auto",
        },
      },
    });

    try {
      const res = await handler(
        buildRequest({ acceptLanguage: "en-US,en;q=0.9" }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.locale, "US");
      assertEquals(body.products.length, 1);
      assertEquals(body.products[0].resolved_price.currency, "USD");
      assertEquals(body.products[0].resolved_price.amount_cents, 999);
      assertEquals(body.products[0].resolved_price.source, "auto");
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "AC-13: Accept-Language hi-IN -> INR pricing row",
  async fn() {
    const productId = "p1";
    const { restore } = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "auto",
        base_price_cents: 999,
        base_currency: "USD",
      }],
      pricingByProductLocale: {
        [`${productId}::IN`]: {
          amount_cents: 29900,
          currency: "INR",
          source: "auto",
        },
      },
    });

    try {
      const res = await handler(
        buildRequest({ acceptLanguage: "hi-IN,en;q=0.9" }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.locale, "IN");
      assertEquals(body.products[0].resolved_price.currency, "INR");
      assertEquals(body.products[0].resolved_price.amount_cents, 29900);
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "AC-13: Accept-Language ja-JP -> JPY pricing row (zero-decimal)",
  async fn() {
    const productId = "p1";
    const { restore } = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "auto",
        base_price_cents: 999,
        base_currency: "USD",
      }],
      pricingByProductLocale: {
        [`${productId}::JP`]: {
          amount_cents: 1100,
          currency: "JPY",
          source: "auto",
        },
      },
    });

    try {
      const res = await handler(buildRequest({ acceptLanguage: "ja-JP" }));
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.locale, "JP");
      assertEquals(body.products[0].resolved_price.currency, "JPY");
      assertEquals(body.products[0].resolved_price.amount_cents, 1100);
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "AC-13: missing Accept-Language header -> defaults to US locale",
  async fn() {
    const productId = "p1";
    const { restore } = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "auto",
        base_price_cents: 999,
        base_currency: "USD",
      }],
      pricingByProductLocale: {
        [`${productId}::US`]: {
          amount_cents: 999,
          currency: "USD",
          source: "auto",
        },
      },
    });

    try {
      const res = await handler(buildRequest({})); // no header at all
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.locale, "US");
      assertEquals(body.products[0].resolved_price.currency, "USD");
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "AC-13: malformed Accept-Language falls back without throwing",
  async fn() {
    const productId = "p1";
    const { restore } = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "auto",
        base_price_cents: 999,
        base_currency: "USD",
      }],
      pricingByProductLocale: {},
    });

    try {
      // "garbage" has no '-' — handler extracts split[1] which is undefined ->
      // defaults to "US". Must not throw under any malformed input.
      const res = await handler(
        buildRequest({ acceptLanguage: "totally-broken-header-value" }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assert(typeof body.locale === "string");
      // No pricing row was provided so the handler falls through to the
      // base_* fallback price.
      assertEquals(body.products[0].resolved_price.currency, "USD");
      assertEquals(body.products[0].resolved_price.amount_cents, 999);
      assertEquals(body.products[0].resolved_price.source, "fallback");
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "AC-8: pricing_mode=global returns global_price_cents regardless of locale",
  async fn() {
    const productId = "p1";
    const stub = installFetchStub({
      products: [{
        id: productId,
        name: "Pro",
        pricing_mode: "global",
        base_price_cents: 999,
        base_currency: "USD",
        global_price_cents: 1499,
        global_currency: "EUR",
      }],
      pricingByProductLocale: {
        // populate IN row to prove it's IGNORED for global mode
        [`${productId}::IN`]: {
          amount_cents: 29900,
          currency: "INR",
          source: "auto",
        },
      },
    });

    try {
      const res = await handler(
        buildRequest({ acceptLanguage: "hi-IN,en;q=0.9" }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.locale, "IN");
      // Global mode bypasses tenant_pricing -> returns global_*
      assertEquals(body.products[0].resolved_price.currency, "EUR");
      assertEquals(body.products[0].resolved_price.amount_cents, 1499);
      assertEquals(body.products[0].resolved_price.source, "global");

      // Sanity: tenant_pricing_resolve must NOT be called for global products
      const resolveCalls = stub.calls.filter((c) =>
        c.url.includes("/rest/v1/rpc/tenant_pricing_resolve")
      ).length;
      assertEquals(
        resolveCalls,
        0,
        "global-mode product must skip tenant_pricing_resolve RPC",
      );
    } finally {
      stub.restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "AC-8: pricing_mode=manual returns tenant_pricing row if exists, else base_price fallback",
  async fn() {
    const productId = "p1";

    // Case A — manual row exists for IN
    {
      const { restore } = installFetchStub({
        products: [{
          id: productId,
          name: "Pro",
          pricing_mode: "manual",
          base_price_cents: 999,
          base_currency: "USD",
        }],
        pricingByProductLocale: {
          [`${productId}::IN`]: {
            amount_cents: 19900, // tenant manually set ₹199
            currency: "INR",
            source: "manual",
          },
        },
      });
      try {
        const res = await handler(buildRequest({ acceptLanguage: "hi-IN" }));
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.products[0].resolved_price.currency, "INR");
        assertEquals(body.products[0].resolved_price.amount_cents, 19900);
        assertEquals(body.products[0].resolved_price.source, "manual");
      } finally {
        restore();
      }
    }

    // Case B — manual, no row for BR -> base fallback
    {
      const { restore } = installFetchStub({
        products: [{
          id: productId,
          name: "Pro",
          pricing_mode: "manual",
          base_price_cents: 999,
          base_currency: "USD",
        }],
        pricingByProductLocale: {}, // no rows
      });
      try {
        const res = await handler(buildRequest({ acceptLanguage: "pt-BR" }));
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.products[0].resolved_price.currency, "USD");
        assertEquals(body.products[0].resolved_price.amount_cents, 999);
        assertEquals(body.products[0].resolved_price.source, "fallback");
      } finally {
        restore();
      }
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "missing apiKey query param -> 400 missing_apiKey",
  async fn() {
    const { restore } = installFetchStub({});
    try {
      const req = new Request("https://test.local/functions/v1/config", {
        method: "GET",
      });
      const res = await handler(req);
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.error, "missing_apiKey");
    } finally {
      restore();
    }
  },
});

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "non-GET method -> 405 Method not allowed",
  async fn() {
    const { restore } = installFetchStub({});
    try {
      const req = new Request(
        "https://test.local/functions/v1/config?apiKey=k",
        { method: "POST" },
      );
      const res = await handler(req);
      assertEquals(res.status, 405);
    } finally {
      restore();
    }
  },
});
