import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Sparkles,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CountryPicker } from "@/components/providers/country-picker"
import {
  recommendationsFor,
  SUPPORTED_COUNTRIES,
  type ProviderRecommendation,
  type Tier,
} from "@/lib/provider-recommendations"
import {
  methodBrand,
  methodState,
  setupPathFor,
  type MethodState,
} from "@/lib/provider-method-state"

/**
 * Region-aware payment providers dashboard.
 *
 * Layout:
 *   1. Country picker / set-up nudge if the merchant hasn't picked yet.
 *   2. "Recommended for {country}" — methods tagged primary/secondary in
 *      provider-recommendations.ts, sorted with primary above secondary.
 *      Each card shows: brand, "why this for you", fee, current status
 *      (connected / configurable / coming soon).
 *   3. "For international customers" — methods tagged international.
 *      Same card shape, with an "audience" hint ("Indian customers" etc).
 *   4. "Coming soon" — disabled cards for unimplemented providers.
 *
 * URL params:
 *   ?preview=US  — render as if the merchant were in US without actually
 *                  saving. Used by the country picker's "preview" rows.
 */
export default async function ProvidersPage({
  searchParams,
}: {
  searchParams?: { preview?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [tenantRes, providersRes, paymentMethodsRes, stripeOauthRes, registryRes] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("country_code")
        .eq("id", tenant.id)
        .single<{ country_code: string | null }>(),
      supabase
        .from("tenant_providers")
        .select("provider")
        .eq("tenant_id", tenant.id),
      supabase.rpc("tenant_payment_methods_list", { p_tenant_id: tenant.id }),
      supabase
        .from("tenant_stripe_connect")
        .select("stripe_account_id")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      supabase
        .from("provider_method_registry")
        .select("method, fee_percent, supports_subscription, supports_one_time"),
    ])

  const savedCountry = tenantRes.data?.country_code ?? null
  const previewCountryRaw = searchParams?.preview?.toUpperCase() ?? null
  const isValidPreview =
    !!previewCountryRaw &&
    SUPPORTED_COUNTRIES.some((c) => c.code === previewCountryRaw)
  const previewCountry = isValidPreview ? previewCountryRaw : null
  const isPreview = !!previewCountry && previewCountry !== savedCountry
  const activeCountry = previewCountry ?? savedCountry

  const recommendations = recommendationsFor(activeCountry)

  const tenantProviders = new Set<string>(
    (providersRes.data ?? []).map((r: any) => r.provider as string),
  )
  const tenantPaymentMethods = new Set<string>(
    (paymentMethodsRes.data ?? [])
      .filter((r: any) => r.enabled)
      .map((r: any) => r.method as string),
  )
  const stripeOAuthConnected = !!stripeOauthRes.data
  const stateInputs = {
    tenantProviders,
    tenantPaymentMethods,
    stripeOAuthConnected,
  }

  const registry = new Map(
    (registryRes.data ?? []).map((r: any) => [r.method, r]),
  )

  // Bucket the recommendations by tier so we can render each section.
  const byTier: Record<Tier, ProviderRecommendation[]> = {
    primary: [],
    secondary: [],
    international: [],
    coming_soon: [],
  }
  for (const rec of recommendations) {
    byTier[rec.tier].push(rec)
  }
  // Filter coming_soon further — if the method has graduated to
  // configurable in code, it shouldn't render as coming-soon anymore.
  byTier.coming_soon = byTier.coming_soon.filter(
    (r) => methodState(r.method, stateInputs) === "coming_soon",
  )

  const connectedCount = recommendations.filter(
    (r) => methodState(r.method, stateInputs) === "connected",
  ).length

  return (
    <div>
      <PageHeader
        title="Payment providers"
        subtitle="Connect at least one. The SDK's router auto-picks the cheapest eligible method per customer (country + currency + product type)."
        actions={
          <CountryPicker
            savedCountry={savedCountry}
            activeCountry={activeCountry}
            isPreview={isPreview}
          />
        }
      />

      {/* Onboarding nudge if no country chosen yet */}
      {!savedCountry && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-ink-900">
              Pick your primary market
            </h3>
            <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">
              Tell us where your business is registered so we can surface the
              providers that work best for you. Indian merchant? UPI Direct
              + Razorpay save you ~7% per Indian transaction vs Stripe. US
              merchant? Stripe is the universal default. Use the country
              picker above to get started.
            </p>
          </div>
        </div>
      )}

      {/* Preview banner */}
      {isPreview && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50/60 p-3 text-xs text-warning-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>Preview mode</strong> — showing what a merchant in{" "}
            <strong>
              {SUPPORTED_COUNTRIES.find((c) => c.code === previewCountry)?.name}
            </strong>{" "}
            would see. Your saved country (
            {savedCountry ?? "not set"}) hasn't changed.
          </span>
        </div>
      )}

      {/* Connected summary */}
      {savedCountry && connectedCount > 0 && (
        <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white border border-emerald-200 flex items-center justify-center">
              <Check className="w-4 h-4 text-emerald-600" strokeWidth={3} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900">
                {connectedCount} method{connectedCount === 1 ? "" : "s"} active
              </h3>
              <p className="text-xs text-emerald-700 mt-0.5">
                The router will pick the cheapest available method per customer
                automatically.
              </p>
            </div>
          </div>
          <Link
            href="/providers/routing"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white text-ink-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex-shrink-0"
          >
            Override routing rules
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Native in-app billing — Google Play / App Store (required for mobile digital goods) */}
      <Section
        eyebrow="In-app billing (native app stores)"
        subtitle="Required for digital subscriptions inside Android/iOS apps. On Android the SDK routes digital checkout through Google Play Billing (Google Play Payments policy) instead of a web page; iOS uses StoreKit. Connect the store, then set each product's store product ID."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StoreCard
            name="Google Play Billing"
            subtitle="Android in-app subscriptions"
            reason="Mandatory for digital goods on Android under Google Play's Payments policy. Connect your Play service account to auto-create/sync subscription products and let the SDK bill via Google Play instead of an external web page."
            href="/providers/google-play"
            connected={tenantProviders.has("google_play")}
          />
          <StoreCard
            name="App Store Connect"
            subtitle="iOS in-app subscriptions (StoreKit)"
            reason="Required for digital goods on iOS. Connect your App Store Connect API key (.p8) to auto-create/sync StoreKit subscription products."
            href="/providers/app-store"
            connected={tenantProviders.has("app_store")}
          />
        </div>
      </Section>

      {/* Tier 1+2: Recommended for {country} */}
      {(byTier.primary.length > 0 || byTier.secondary.length > 0) && (
        <Section
          eyebrow={
            activeCountry
              ? `Recommended for ${SUPPORTED_COUNTRIES.find((c) => c.code === activeCountry)?.name ?? activeCountry}`
              : "Recommended"
          }
          subtitle={
            activeCountry === "IN"
              ? "Indian-native methods first — much lower fees than cross-border Stripe."
              : activeCountry
                ? "Best for accepting payments from customers in your country."
                : "Universal defaults until you tell us where you operate."
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {byTier.primary.map((r) => (
              <ProviderCard
                key={r.method}
                recommendation={r}
                state={methodState(r.method, stateInputs)}
                feePercent={registry.get(r.method)?.fee_percent}
                supportsSubscription={
                  registry.get(r.method)?.supports_subscription
                }
                supportsOneTime={registry.get(r.method)?.supports_one_time}
              />
            ))}
            {byTier.secondary.map((r) => (
              <ProviderCard
                key={r.method}
                recommendation={r}
                state={methodState(r.method, stateInputs)}
                feePercent={registry.get(r.method)?.fee_percent}
                supportsSubscription={
                  registry.get(r.method)?.supports_subscription
                }
                supportsOneTime={registry.get(r.method)?.supports_one_time}
                muted
              />
            ))}
          </div>
        </Section>
      )}

      {/* Tier 3: International customers */}
      {byTier.international.length > 0 && (
        <Section
          eyebrow="For international customers"
          subtitle="Add these if you have audiences outside your primary market."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {byTier.international.map((r) => (
              <ProviderCard
                key={r.method}
                recommendation={r}
                state={methodState(r.method, stateInputs)}
                feePercent={registry.get(r.method)?.fee_percent}
                supportsSubscription={
                  registry.get(r.method)?.supports_subscription
                }
                supportsOneTime={registry.get(r.method)?.supports_one_time}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Tier 4: Coming soon */}
      {byTier.coming_soon.length > 0 && (
        <Section
          eyebrow="Coming soon"
          subtitle="On the roadmap — let us know which you'd use most via /webhooks → Feedback."
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {byTier.coming_soon.map((r) => (
              <ComingSoonCard key={r.method} recommendation={r} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({
  eyebrow,
  subtitle,
  children,
}: {
  eyebrow: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10 animate-slide-up">
      <div className="mb-4">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-400">
          {eyebrow}
        </span>
        {subtitle && <p className="text-ink-500 text-sm mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function ProviderCard({
  recommendation,
  state,
  feePercent,
  supportsSubscription,
  supportsOneTime,
  muted = false,
}: {
  recommendation: ProviderRecommendation
  state: MethodState
  feePercent: number | undefined
  supportsSubscription: boolean | undefined
  supportsOneTime: boolean | undefined
  muted?: boolean
}) {
  const brand = methodBrand(recommendation.method)
  const setupPath = setupPathFor(recommendation.method)
  const fee =
    typeof feePercent === "number" ? `${feePercent.toFixed(1)}% per txn` : null

  return (
    <Card
      className={`transition-all duration-200 ${
        muted ? "opacity-80" : ""
      } hover:-translate-y-0.5 hover:shadow-md ${
        state === "connected"
          ? "border-emerald-200 bg-emerald-50/30"
          : "border-ink-200"
      }`}
    >
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-ink-900">{brand.name}</h3>
              {recommendation.audience && (
                <span className="text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                  {recommendation.audience}
                </span>
              )}
            </div>
            {brand.subtitle && (
              <p className="text-[11px] text-ink-500 mt-0.5">{brand.subtitle}</p>
            )}
          </div>
          {state === "connected" ? (
            <Badge tone="success" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="neutral">Setup</Badge>
          )}
        </div>

        <p className="text-xs text-ink-700 leading-relaxed mb-3">
          {recommendation.reason}
        </p>

        <div className="flex items-center gap-2 mb-4 text-[11px]">
          {fee && (
            <span
              className={`font-bold ${
                (feePercent ?? 0) === 0
                  ? "text-emerald-700"
                  : (feePercent ?? 0) < 2
                    ? "text-emerald-700"
                    : (feePercent ?? 0) < 3
                      ? "text-brand-700"
                      : "text-ink-600"
              }`}
            >
              {fee}
            </span>
          )}
          {supportsSubscription && (
            <span className="text-ink-400">· Subscriptions ✓</span>
          )}
          {supportsOneTime && !supportsSubscription && (
            <span className="text-ink-400">· One-time only</span>
          )}
        </div>

        {setupPath ? (
          <Link
            href={setupPath}
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
              state === "connected"
                ? "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50"
                : "bg-ink-900 text-white hover:bg-ink-800"
            }`}
          >
            {state === "connected" ? "Manage" : "Set up"}
            <ArrowRight className="w-3 h-3" />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-400 px-3 py-1.5">
            <Clock className="w-3 h-3" />
            Setup page coming soon
          </span>
        )}
      </CardBody>
    </Card>
  )
}

function StoreCard({
  name,
  subtitle,
  reason,
  href,
  connected,
}: {
  name: string
  subtitle: string
  reason: string
  href: string
  connected: boolean
}) {
  return (
    <Card
      className={`transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        connected ? "border-emerald-200 bg-emerald-50/30" : "border-ink-200"
      }`}
    >
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-bold text-ink-900">{name}</h3>
            <p className="text-[11px] text-ink-500 mt-0.5">{subtitle}</p>
          </div>
          {connected ? (
            <Badge tone="success" dot>
              Connected
            </Badge>
          ) : (
            <Badge tone="neutral">Setup</Badge>
          )}
        </div>

        <p className="text-xs text-ink-700 leading-relaxed mb-4">{reason}</p>

        <Link
          href={href}
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
            connected
              ? "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50"
              : "bg-ink-900 text-white hover:bg-ink-800"
          }`}
        >
          {connected ? "Manage" : "Connect"}
          <ArrowRight className="w-3 h-3" />
        </Link>
      </CardBody>
    </Card>
  )
}

function ComingSoonCard({
  recommendation,
}: {
  recommendation: ProviderRecommendation
}) {
  const brand = methodBrand(recommendation.method)
  return (
    <Card className="border-ink-100 bg-ink-50/40">
      <CardBody className="p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <h3 className="text-sm font-bold text-ink-700">{brand.name}</h3>
        </div>
        {brand.subtitle && (
          <p className="text-[10px] text-ink-500 leading-relaxed">
            {brand.subtitle}
          </p>
        )}
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">
          <Clock className="w-2.5 h-2.5" />
          Roadmap
        </div>
      </CardBody>
    </Card>
  )
}
