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
import { diverges, resolveServed, resolveShadow } from "../_shared/pricing-shadow.ts"
import {
  RateLimitError,
  rateLimitResponse,
  requireRateLimit,
} from "../_shared/rate-limit.ts"

/** Map a routing method name (stripe_card, razorpay_upi, direct_upi…) to its provider. */
function methodToProvider(method: string): string {
  if (method.startsWith("stripe")) return "stripe"
  if (method.startsWith("razorpay")) return "razorpay"
  if (method.startsWith("direct_upi") || method.startsWith("upi")) return "direct_upi"
  if (method.startsWith("cashfree")) return "cashfree"
  return method
}

/**
 * Order [providers] by the tenant's PLATFORM routing preference (migration 075) so the SDK's
 * first provider is the tenant's intended primary for THIS caller platform (e.g. Stripe on
 * desktop, Razorpay on Android) instead of an arbitrary DB order. Uses the highest-priority
 * routing rule whose platform matches [platform] or is the "any" wildcard; providers named
 * earliest in that rule's priority_methods come first, unmentioned providers keep their relative
 * order at the end. Each returned provider is tagged with the resolved [platform]. Non-fatal:
 * returns the input order (still platform-tagged) on any error or when no rule matches.
 */
async function orderProvidersByPlatform(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string,
  platform: string | null,
  // deno-lint-ignore no-explicit-any
  providers: any[],
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const tagged = providers.map((p) => ({ ...p, platform }))
  try {
    const { data: rules } = await supabase
      .from("tenant_routing_rules")
      .select("platform, priority_methods, priority")
      .eq("tenant_id", tenantId)
      .order("priority", { ascending: true })
    // deno-lint-ignore no-explicit-any
    const match = (rules ?? []).find((r: any) => {
      const rp = r.platform ?? "any"
      return rp === "any" || rp === platform
    })
    if (!match || !Array.isArray(match.priority_methods)) return tagged
    const rank = new Map<string, number>()
    match.priority_methods.forEach((m: string, i: number) => {
      const prov = methodToProvider(m)
      if (!rank.has(prov)) rank.set(prov, i)
    })
    if (rank.size === 0) return tagged
    return [...tagged].sort(
      (a, b) => (rank.get(a.provider) ?? 999) - (rank.get(b.provider) ?? 999),
    )
  } catch (_e) {
    return tagged
  }
}

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

  // Locale extraction from Accept-Language header (default US). The SDK already sends its
  // storefront-first resolved country here, so this stays authoritative for per-locale pricing.
  const acceptLanguage = req.headers.get("accept-language") ?? "en-US"
  const localeCountry =
    (acceptLanguage.split(",")[0].split("-")[1] ?? "US").toUpperCase()

  // Unified server IP-geo: the hosting edge (Vercel / Cloudflare / CloudFront) attaches the buyer's
  // country as a request header. Return it as `geo_country` so the SDK's CountryDetector can fold
  // it below the store storefront and above the device locale — one consistent signal on every
  // platform, including web/desktop where no store storefront exists. Null when the edge did not
  // attach a header (local dev / unknown host); the SDK degrades to device/locale in that case.
  // Header order and validation are deliberately IDENTICAL to dashboard/lib/customer-geo.ts.
  // They were not, and the two chains disagreed on five real inputs — a buyer priced one way in the
  // app and another way through web checkout (AC-19). Cloudflare first because that is the runtime
  // this deploys on; the ISO-2 shape check and the "XX" rejection are the dashboard's, which were
  // the stricter and more correct of the two: "XX" is the CDN's *unknown-country* placeholder, so
  // treating it as a country prices someone in a country that does not exist, and a 3-letter code
  // is not an ISO-3166-alpha-2 value at all.
  const GEO_HEADERS = [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "cloudfront-viewer-country",
    "x-country",
    "x-geo-country",
  ] as const
  const ISO2 = /^[A-Z]{2}$/
  let geoCountry: string | null = null
  for (const h of GEO_HEADERS) {
    const raw = req.headers.get(h)?.trim()?.toUpperCase()
    if (raw && ISO2.test(raw) && raw !== "XX") { geoCountry = raw; break }
  }
  const geoSource = geoCountry ? "SERVER_IP_GEO" : "ABSENT"

  // Caller platform (SDK sends X-PayCraft-Platform: ios|android|desktop|web). Drives per-platform
  // provider ordering below (migration 075). Null when absent → "any" routing rules still apply.
  const callerPlatform =
    (req.headers.get("x-paycraft-platform") ?? "").trim().toLowerCase() || null

  // ── D11 Stage A: compute BOTH price-country chains; keep serving the OLD one ──────────────
  // The served chain stays locale-only so this deploy cannot move a single price. The shadow
  // chain is the corrected precedence, and the delta between them is what makes the Stage B
  // cut-over an evidence-based decision rather than a leap.
  //
  // `sdkCountry` is the Accept-Language country ONLY when a platform header proves an SDK sent it.
  // A real browser has no such header, so its Accept-Language stays a language preference and the
  // shadow chain falls through to server geo — which is the actual revenue fix (a US buyer whose
  // browser prefers fr-FR is currently billed in EUR).
  // `?country=` ONLY. `x-country` used to be an override alias here while the dashboard treated it
  // as a geo header — the same request resolved with a different PROVENANCE depending on which
  // entry point served it. An override should be something a caller states explicitly in the URL,
  // not a header a CDN might inject on its behalf. It is a geo header on both sides now.
  const overrideRaw = new URL(req.url).searchParams.get("country")?.trim()?.toUpperCase() || null
  const overrideCountry = overrideRaw && ISO2.test(overrideRaw) && overrideRaw !== "XX"
    ? overrideRaw
    : null
  // Whitelisted, not cast. This value is client-supplied and flows into every product row AND into
  // paycraft_price_shadow_deltas — the table an operator reads before authorising the Stage B
  // cut-over. An `as never` cast let arbitrary text through, so the audit trail the release
  // decision rests on was shapeable by any caller.
  const PROVENANCE_VALUES = [
    "override", "storefront", "server_geo", "device", "locale", "default",
  ] as const
  const rawProvenance =
    (req.headers.get("x-paycraft-country-provenance") ?? "").trim().toLowerCase() || null
  const sdkProvenanceHeader =
    rawProvenance && (PROVENANCE_VALUES as readonly string[]).includes(rawProvenance)
      ? rawProvenance
      : null
  const priceInputs = {
    overrideCountry,
    sdkCountry: callerPlatform ? localeCountry : null,
    sdkProvenance: sdkProvenanceHeader as never,
    geoCountry,
    localeCountry,
    platform: (callerPlatform ?? "unknown") as never,
  }
  const servedCountryResolved = resolveServed(priceInputs)
  const shadowCountryResolved = resolveShadow(priceInputs)

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
  // Falls back to the caller IP when the tenant is anonymous.
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    await requireRateLimit(supabase, tenantId, ipAddress, "config_fetch", 60, 1)
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e)
    throw e
  }

  // ── D11 Stage B admissibility (AC-18) ────────────────────────────────────────────────────
  // The cut-over needs TWO independent things to be true: the operator switched it on, AND a human
  // has actually read a recorded divergence for this tenant. The flag alone is not enough — the
  // whole point of Stage A is that somebody looks at the delta before real money moves. Fails
  // CLOSED: any error resolving admissibility leaves Stage A behaviour in place.
  //
  // read_at is stamped only by `core/scripts/paycraft-record-shadow-read.sh`, never by hand.
  let stageBAdmissible = false
  if (Deno.env.get("PAYCRAFT_PRICE_CUTOVER") === "1") {
    const { data: readOk, error: readErr } = await supabase.rpc("paycraft_shadow_read_recorded", {
      p_tenant_id: tenantId,
    })
    stageBAdmissible = !readErr && readOk === true
  }
  const cutoverOn = stageBAdmissible
  // Stage B: the shadow chain becomes the served one. Stage A: unchanged.
  const effectiveCountry = cutoverOn ? shadowCountryResolved : servedCountryResolved

  // 3. Fetch components in parallel
  const [productsRes, paywallRes, providersRes, tenantRes] = await Promise.all([
    supabase.rpc("tenant_products_list", { p_tenant_id: tenantId }),
    supabase.rpc("tenant_paywall_get", { p_tenant_id: tenantId }),
    supabase
      .from("tenant_providers")
      .select(
        "provider,test_payment_links,live_payment_links,supported_locales,is_active",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
    supabase
      .from("tenants")
      .select("plan,entitlements")
      .eq("id", tenantId)
      .single(),
  ])

  // Mode-aware: the SDK reads payment_links from the matching map per
  // `apiKey.startsWith("pk_test_")` → testPaymentLinks; pk_live_* → livePaymentLinks.
  // We surface only the relevant map here so older SDKs that don't know about mode
  // duality still pick the correct one.
  const isTestMode = apiKey.startsWith("pk_test_")

  // 4. Resolve per-locale price for each product + project trial fields with safe
  //    defaults so the SDK always receives a fully-formed ProductDto regardless of
  //    how old a tenant's data is on disk.
  //
  //    Test/live duality is resolved client-side: the SDK picks `testPaymentLinks`
  //    vs `livePaymentLinks` from each provider based on the apiKey prefix —
  //    no server-side product filtering required. (Migration 069 dropped the
  //    legacy is_test_only product flag + test_devices allow-list.)
  // AC-11 / D6 note: a disabled product is ALREADY absent here — `tenant_products_list`
  // (migration 028) filters `active = true` server-side, so the disable toggle takes effect at
  // the RPC rather than in this projection. Deliberately NOT re-filtering: a second filter in
  // this file would drift from the RPC the day someone changes one and not the other.
  //
  // What was genuinely missing is the error check below. `productsRes.data ?? []` silently
  // degrades a DATABASE FAILURE into an empty product array and a 200 response — a paywall that
  // renders "nothing for sale" while the real cause is an outage, which is indistinguishable to
  // the SDK from a tenant who has configured no products. Failing loudly is the only way the
  // client can tell "no products" from "could not read products" and show a retry instead.
  if (productsRes.error) {
    return new Response(
      JSON.stringify({
        error: "products_query_failed",
        detail: productsRes.error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  // The same reasoning applied to the other three reads. Sub-plan 02 fixed products and left these
  // swallowing their errors, so each still turned a database failure into a plausible-looking 200:
  //
  //   paywallRes   — `paywallRes.data ?? {}` degrades to DEFAULT styling and default copy, so an
  //                  outage renders as "this tenant never customised their paywall".
  //   providersRes — `providersRes.data ?? []` degrades to ZERO providers, which the SDK renders as
  //                  a paywall with no way to pay. Indistinguishable from a tenant who has
  //                  connected none, and the more damaging of the two because it looks like a
  //                  configuration problem the operator must go fix.
  //   tenantRes    — `tenantRes.data?.entitlements ?? []` degrades to NO entitlements, which can
  //                  gate features off for a tenant who is entitled to them.
  //
  // Each gets its own error code rather than one shared one: the SDK's resilience chain treats
  // these differently, and a single "config_query_failed" would tell whoever reads the logs that
  // something broke without saying which read.
  if (paywallRes.error) {
    return new Response(
      JSON.stringify({ error: "paywall_query_failed", detail: paywallRes.error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
  if (providersRes.error) {
    return new Response(
      JSON.stringify({ error: "providers_query_failed", detail: providersRes.error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
  // `.single()` reports PGRST116 when the row is absent. That is NOT a transport failure — it means
  // the tenant row is gone even though the api key resolved to its id, which is a real integrity
  // problem and deserves its own status rather than being folded into a generic 500.
  if (tenantRes.error) {
    const missingRow = (tenantRes.error as { code?: string }).code === "PGRST116"
    return new Response(
      JSON.stringify({
        error: missingRow ? "tenant_row_missing" : "tenant_query_failed",
        detail: tenantRes.error.message,
      }),
      { status: missingRow ? 404 : 500, headers: { "Content-Type": "application/json" } },
    )
  }

  const pricedProducts = await Promise.all(
    (productsRes.data ?? []).map(async (p: Record<string, unknown>) => {
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
      // Stage A: servedCountryResolved.country IS localeCountry (plus the pre-existing override),
      // so this call is byte-identical to pre-deploy. Routing it through the resolver now means the
      // Stage B flip is a one-line change at the resolver, not surgery at the call site.
      const priceRes = await supabase.rpc("tenant_pricing_resolve", {
        p_tenant_id: tenantId,
        p_product_id: p.id,
        p_locale: effectiveCountry.country,
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
        // AC-16 — both chains travel on EVERY product row, always. A client that only ever sees
        // the served value cannot tell a correct price from a lucky one; carrying the shadow makes
        // the divergence observable at the point of sale, not only in the server-side log.
        served_country: effectiveCountry.country,
        served_provenance: effectiveCountry.provenance,
        shadow_country: shadowCountryResolved.country,
        shadow_provenance: shadowCountryResolved.provenance,
      }
    }),
  )

  // ── AC-17: record the divergence, never let it break the response ───────────────────────
  // Deliberately fire-and-forget with a swallowed error: this is an observability write, and a
  // logging failure must not turn a working paywall into a 500. That is the opposite trade-off
  // from the products query above, where an empty result IS the user-visible failure.
  if (diverges(servedCountryResolved, shadowCountryResolved)) {
    try {
      await supabase.rpc("paycraft_shadow_delta_record", {
        p_tenant_id: tenantId,
        p_platform: callerPlatform ?? "unknown",
        p_served_country: servedCountryResolved.country,
        p_served_provenance: servedCountryResolved.provenance,
        p_shadow_country: shadowCountryResolved.country,
        p_shadow_provenance: shadowCountryResolved.provenance,
      })
    } catch (_e) {
      // intentional-noop: divergence telemetry is best-effort by design.
    }
  }

  // 5. Filter providers:
  //    (a) locale-supported (null/empty supported_locales = all locales),
  //    (b) at least one (sku, currency) payment link for the current mode —
  //        the nested map is shaped {sku: {currency: url}}; skip the provider
  //        if every per-sku entry is empty so the SDK's provider sheet doesn't
  //        offer dead options.
  const enabledProviders = (providersRes.data ?? []).filter(
    (pr: {
      supported_locales?: string[] | null
      test_payment_links?: Record<string, Record<string, string>> | null
      live_payment_links?: Record<string, Record<string, string>> | null
    }) => {
      const localeOk = !pr.supported_locales ||
        pr.supported_locales.length === 0 ||
        // effectiveCountry, not localeCountry: after cut-over a buyer priced on server_geo (say IN)
        // would otherwise only be offered providers whose supported_locales carry their
        // Accept-Language country (say US) — priced in one country, unable to pay in it.
        pr.supported_locales.includes(effectiveCountry.country)
      const bySku = isTestMode ? pr.test_payment_links : pr.live_payment_links
      const linksOk = !!bySku && Object.values(bySku).some(perCurrency =>
        !!perCurrency && Object.keys(perCurrency).length > 0
      )
      return localeOk && linksOk
    },
  )

  // 5b. Platform-filtered ordered providers (migration 075): order the enabled providers by the
  //     tenant's routing preference for this caller platform so the SDK's primary provider is the
  //     intended one per platform (Stripe on desktop, Razorpay on Android, …), not an arbitrary
  //     DB order. Non-fatal — falls back to the enabled order when no rule matches.
  const orderedProviders = await orderProvidersByPlatform(
    supabase,
    tenantId,
    callerPlatform,
    enabledProviders,
  )

  // 6. Tier-derived branding override:
  //    Free tier always shows attribution regardless of paywall config.
  const tierEntitlements: string[] =
    (tenantRes.data?.entitlements as string[] | null) ?? []
  const declaredBranding = (paywallRes.data?.branding as string) ?? "attribution"
  const brandingFinal = tierEntitlements.includes("remove_attribution")
    ? declaredBranding
    : "attribution"

  // PaywallDto v2 (migration 071) — when paywallRes.data is present we just spread it
  // (every v2 column is included automatically). When no tenant_paywall row exists yet,
  // emit a v2-default body so the SDK has all the fields it expects rather than choking
  // on missing keys. Defaults match migration 071's column-level DEFAULT clauses so the
  // fallback shape mirrors a freshly-inserted row.
  //
  // Phase-4 clean-SDK (cmp-paycraft 2.1.x, AC-9): expose a top-level `"mode"` field
  // — `"ad_supported" | "trial_managed" | null` — that the SDK reads as the config-
  // wins override for its init-time MonetizationMode flag. Sourced from a future
  // `tenant_paywall.mode` (or `tenants.monetization_mode`) column; until the migration
  // lands the read returns null and the SDK falls back to its init flag (default
  // AdSupported) — additive/safe, older SDKs with ignoreUnknownKeys=true skip it.
  const paywallRow = paywallRes.data as Record<string, unknown> | null
  const tenantRow = tenantRes.data as Record<string, unknown> | null
  const monetizationMode =
    (paywallRow?.["mode"] as string | undefined) ??
    (tenantRow?.["monetization_mode"] as string | undefined) ??
    null

  // PayCraft-hosted default legal URLs. The SDK paywall footer renders the
  // Privacy & Terms links from paywall.privacy_url / paywall.terms_url. When a
  // tenant hasn't configured their own, fall back to PayCraft's hosted,
  // store-compliant pages so EVERY paywall carries valid legal links (Google
  // Play and the App Store require them). A non-empty tenant value always wins.
  const PAYCRAFT_PRIVACY_URL = "https://paycraft.mobilebytesensei.com/legal/privacy"
  const PAYCRAFT_TERMS_URL = "https://paycraft.mobilebytesensei.com/legal/terms"

  const basePaywall = paywallRes.data
    ? { ...paywallRes.data, branding: brandingFinal }
    : {
        template: "branded-stack",
        branding: brandingFinal,
        theme_jsonb: {},
        hero_title: "Upgrade to Premium",
        hero_subtitle: "Enjoy ad-free experience, HD downloads, and exclusive features",
        value_props: [],
        cta_continue: "Continue",
        cta_get_premium: "Get Premium",
        restore_label: "Restore Your Premium",
        success_title: "Welcome to Premium!",
        success_message: "You now have access to all premium features.",
        success_cta_label: "Continue to app",
        // Trial-terms disclosure (migration 077) — defaults match the SDK strings.xml
        // fallbacks so an un-configured tenant still ships a Play-compliant disclosure.
        trial_terms_template: "{days}-day free trial, then {price}",
        trial_disclosure_title: "{days}-day free trial included",
        trial_disclosure_body:
          "Your free trial converts to a paid subscription automatically when it ends. Cancel anytime before then in your store subscription settings to avoid being charged.",
      }
  const paywallWithLegal = {
    ...basePaywall,
    privacy_url:
      ((basePaywall as Record<string, unknown>)["privacy_url"] as string | undefined) ||
      PAYCRAFT_PRIVACY_URL,
    terms_url:
      ((basePaywall as Record<string, unknown>)["terms_url"] as string | undefined) ||
      PAYCRAFT_TERMS_URL,
  }

  const body = {
    tenant_id: tenantId,
    plan: tenantRes.data?.plan,
    products: pricedProducts,
    providers: orderedProviders,
    paywall: paywallWithLegal,
    // The country actually priced on. Emitting the raw Accept-Language country here would make
    // SuiteConfig.locale disagree with served_country the moment cut-over lands.
    locale: effectiveCountry.country,
    geo_country: geoCountry,
    geo_source: geoSource,
    served_country: effectiveCountry.country,
    served_provenance: effectiveCountry.provenance,
    price_cutover: cutoverOn,
    shadow_country: shadowCountryResolved.country,
    shadow_provenance: shadowCountryResolved.provenance,
    // Phase-4 config-wins MonetizationMode passthrough — see comment above.
    mode: monetizationMode,
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
