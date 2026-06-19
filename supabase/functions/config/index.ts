// supabase/functions/config/index.ts
// PayCraft SuiteConfig fetcher — single source of truth for SDK integration.
//
// GET /functions/v1/config?apiKey=pk_live_…
// Accept-Language: en-IN (optional — locale derived from country code)
//
// Returns:
//   {
//     tenant_id, plan, products[], providers[], paywall, locale, cache_ttl_seconds
//   }

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  RateLimitError,
  rateLimitResponse,
  requireRateLimit,
} from "../_shared/rate-limit.ts"

export async function handleConfigRequest(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  const url = new URL(req.url)
  const apiKey = url.searchParams.get("apiKey")
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "missing_apiKey" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }

  // Optional per-request device fingerprint. The SDK computes this once at
  // install and sends it on every /config request. If the fingerprint is
  // registered in the tenant's test_devices allow-list, products marked
  // is_test_only are included in the response — otherwise they are stripped
  // before the response is built. Signed prod APKs whose fingerprint isn't
  // registered physically cannot see test-only products.
  const deviceId = url.searchParams.get("device_id")

  // Locale extraction from Accept-Language header (default US)
  const acceptLanguage = req.headers.get("accept-language") ?? "en-US"
  const localeCountry =
    (acceptLanguage.split(",")[0].split("-")[1] ?? "US").toUpperCase()

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // 1. Resolve tenant from API key
  const { data: tenantId, error: resolveErr } = await supabase.rpc(
    "resolve_tenant",
    { p_api_key: apiKey },
  )
  if (resolveErr || !tenantId) {
    return new Response(JSON.stringify({ error: "invalid_apiKey" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  // 2. Per-tenant rate limit (60 burst / 1 refill per second).
  try {
    await requireRateLimit(supabase, tenantId, "config_fetch", 60, 1)
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e)
    throw e
  }

  // 3. Fetch components in parallel
  const [productsRes, paywallRes, providersRes, tenantRes] = await Promise.all([
    supabase.rpc("tenant_products_list", { p_tenant_id: tenantId }),
    supabase.rpc("tenant_paywall_get", { p_tenant_id: tenantId }),
    supabase
      .from("tenant_providers")
      .select(
        "provider,test_payment_links,live_payment_links,supported_locales",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("tenants")
      .select("plan,entitlements")
      .eq("id", tenantId)
      .single(),
  ])

  // 3a. Resolve test-device gate ONCE before product loop.
  //
  // is_test_only products are silently dropped from the response unless the
  // requester's device_id is in the tenant's test_devices allow-list. The
  // server is the source of truth — a missing or unmatched device_id means
  // the product never appears in the JSON response at all, so signed prod
  // APKs cannot leak it no matter what the client does.
  let isRegisteredTestDevice = false
  if (deviceId && deviceId.trim().length > 0) {
    const { data: registered } = await supabase.rpc(
      "test_devices_is_registered",
      { p_tenant_id: tenantId, p_device_id: deviceId.trim() },
    )
    isRegisteredTestDevice = Boolean(registered)
  }

  // 4. Resolve per-locale price for each product + project trial fields with safe
  //    defaults so the SDK always receives a fully-formed ProductDto regardless of
  //    how old a tenant's data is on disk.
  //
  //    Filter out is_test_only products for unregistered devices BEFORE the
  //    price-resolution work — avoids unnecessary tenant_pricing lookups.
  const visibleProducts = (productsRes.data ?? []).filter(
    (p: Record<string, unknown>) => {
      if (!p.is_test_only) return true
      return isRegisteredTestDevice
    },
  )
  const pricedProducts = await Promise.all(
    visibleProducts.map(async (p: Record<string, unknown>) => {
      const trialEnabled = p.trial_enabled === undefined || p.trial_enabled === null
        ? true
        : Boolean(p.trial_enabled)
      const trialDurationDays = typeof p.trial_duration_days === "number"
        ? p.trial_duration_days
        : 7

      // Pull through the promotional-discount fields with safe defaults.
      // The SDK paywall reads these to render strike-through + discounted price.
      const discountPercent = typeof p.discount_percent === "number"
        ? p.discount_percent
        : null
      const discountEndsAt = typeof p.discount_ends_at === "string"
        ? p.discount_ends_at
        : null

      // Auto-expire the discount server-side so stale rows never reach the SDK.
      const discountActive =
        discountPercent !== null &&
        (discountEndsAt === null || new Date(discountEndsAt) > new Date())

      // Global mode: single price worldwide — skip tenant_pricing lookup.
      if (p.pricing_mode === "global" && p.global_price_cents && p.global_currency) {
        return {
          ...p,
          trial_enabled: trialEnabled,
          trial_duration_days: trialDurationDays,
          discount_percent: discountActive ? discountPercent : null,
          discount_ends_at: discountActive ? discountEndsAt : null,
          resolved_price: {
            amount_cents: p.global_price_cents,
            currency: p.global_currency,
            source: "global",
          },
        }
      }

      // Auto / manual mode: resolve locale-specific price from tenant_pricing rows.
      const priceRes = await supabase.rpc("tenant_pricing_resolve", {
        p_tenant_id: tenantId,
        p_product_id: p.id,
        p_locale: localeCountry,
      })
      const priceRow = priceRes.data?.[0]
      const resolved_price = priceRow
        ? {
            amount_cents: priceRow.amount_cents,
            currency: priceRow.currency,
            source: priceRow.source,
          }
        : {
            amount_cents: p.base_price_cents,
            currency: p.base_currency,
            source: "fallback",
          }
      return {
        ...p,
        trial_enabled: trialEnabled,
        trial_duration_days: trialDurationDays,
        discount_percent: discountActive ? discountPercent : null,
        discount_ends_at: discountActive ? discountEndsAt : null,
        resolved_price,
      }
    }),
  )

  // 5. Locale-filter providers
  const enabledProviders = (providersRes.data ?? []).filter(
    (pr: { supported_locales?: string[] | null }) =>
      !pr.supported_locales || pr.supported_locales.includes(localeCountry),
  )

  // 6. Tier-derived branding override:
  //    Free tier always shows attribution regardless of paywall config.
  const tierEntitlements: string[] =
    (tenantRes.data?.entitlements as string[] | null) ?? []
  const declaredBranding = (paywallRes.data?.branding as string) ?? "attribution"
  const brandingFinal = tierEntitlements.includes("remove_attribution")
    ? declaredBranding
    : "attribution"

  const body = {
    tenant_id: tenantId,
    plan: tenantRes.data?.plan,
    products: pricedProducts,
    providers: enabledProviders,
    paywall: paywallRes.data
      ? { ...paywallRes.data, branding: brandingFinal }
      : { template: "minimal", branding: brandingFinal },
    locale: localeCountry,
    cache_ttl_seconds: 3600,
  }

  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=3600",
    },
  })
}

// Register HTTP listener. Skipped when imported under Deno test (env var
// CONFIG_SKIP_SERVE=1) so tests can import handleConfigRequest without
// binding a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  serve(handleConfigRequest)
}
