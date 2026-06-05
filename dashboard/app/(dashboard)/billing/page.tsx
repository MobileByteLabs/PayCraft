import Link from "next/link"
import {
  ArrowUpRight,
  Calendar,
  Check,
  Crown,
  Infinity as InfinityIcon,
  Package,
  Users,
  Webhook,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { clsx } from "clsx"

interface TierDef {
  tier_name: "free" | "pro" | "enterprise"
  display_name: string
  max_active_subscribers: number | null
  max_webhook_events_per_month: number | null
  max_connected_providers: number | null
  max_products: number | null
  analytics_retention_days: number
  attribution_required: boolean
  entitlements: string[]
  base_price_cents: number
  base_currency: string
  metered_per_subscriber_cents: number
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  multi_provider: "Multiple payment providers (bottom sheet)",
  unlimited_subscribers: "Unlimited subscribers",
  remove_attribution: "Remove PayCraft attribution footer",
  analytics_90day: "90-day analytics retention",
  team_size_unlimited: "Unlimited dashboard team members",
  custom_branding: "Custom paywall branding",
  self_host_license: "Self-host Enterprise license",
}

export default async function BillingPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [tierRes, usageRes, webhookRes, productsRes, providersRes] =
    await Promise.all([
      supabase
        .from("tier_definitions")
        .select("*")
        .eq("tier_name", tenant.plan)
        .single(),
      supabase
        .from("tenant_subscriber_count_view")
        .select("active_count,trial_count,canceled_count")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      supabase
        .from("tenant_webhook_delivery_view")
        .select("total,success_rate")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      supabase
        .from("tenant_products")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("active", true),
      supabase
        .from("tenant_providers")
        .select("provider", { count: "exact", head: true })
        .eq("tenant_id", tenant.id),
    ])

  const tier = tierRes.data as TierDef | null
  const activeSubs = usageRes.data?.active_count ?? 0
  const webhookTotal = webhookRes.data?.total ?? 0
  const productCount = productsRes.count ?? 0
  const providerCount = providersRes.count ?? 0

  const subUsageRatio = tier?.max_active_subscribers
    ? activeSubs / tier.max_active_subscribers
    : 0
  const overWarn = subUsageRatio >= 0.8
  const overLimit = subUsageRatio >= 1.0

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Your tier, usage meters, and entitlements. Limits are tunable post-launch via the tier_definitions config table — no code redeploy needed."
        badge={
          <Badge
            tone={
              tenant.plan === "enterprise"
                ? "brand"
                : tenant.plan === "pro"
                ? "success"
                : "neutral"
            }
            dot={tenant.plan === "free" && overWarn}
          >
            {tier?.display_name ?? tenant.plan}
          </Badge>
        }
        actions={
          tenant.plan !== "enterprise" && (
            <ButtonLink
              href="/billing/upgrade"
              leading={<ArrowUpRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Upgrade
            </ButtonLink>
          )
        }
      />

      {/* Grace warning */}
      {overWarn && tenant.plan === "free" && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 flex items-start gap-3 animate-fade-in">
          <div className="w-8 h-8 rounded-md bg-warning-100 text-warning-700 flex items-center justify-center flex-shrink-0">
            <Users className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-warning-700">
              {overLimit
                ? "You're over the Free tier limit"
                : `${Math.round(subUsageRatio * 100)}% of your Free tier limit`}
            </div>
            <div className="text-xs text-warning-600 mt-0.5">
              {overLimit
                ? "New device registrations are in a 7-day grace period. Upgrade to Pro to keep accepting subscribers."
                : "At 100%, new device registrations enter a 7-day grace period before being refused. Upgrade to Pro for 1,000 subscribers included."}
            </div>
          </div>
          <ButtonLink href="/billing/upgrade" size="sm" variant="secondary">
            Upgrade now
          </ButtonLink>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 animate-slide-up">
        <UsageMeter
          label="Active subscribers"
          icon={<Users className="w-4 h-4" />}
          current={activeSubs}
          limit={tier?.max_active_subscribers ?? null}
        />
        <UsageMeter
          label="Webhook events (30d)"
          icon={<Webhook className="w-4 h-4" />}
          current={webhookTotal}
          limit={tier?.max_webhook_events_per_month ?? null}
        />
        <UsageMeter
          label="Connected providers"
          icon={<Webhook className="w-4 h-4" />}
          current={providerCount}
          limit={tier?.max_connected_providers ?? null}
        />
        <UsageMeter
          label="Active products"
          icon={<Package className="w-4 h-4" />}
          current={productCount}
          limit={tier?.max_products ?? null}
        />
      </section>

      <Card>
        <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
          <Crown className="w-4 h-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-900">
            Tier entitlements
          </h2>
          <span className="text-xs text-ink-500 ml-auto">
            What's included in {tier?.display_name}
          </span>
        </div>
        <CardBody className="!py-2">
          {Object.entries(ENTITLEMENT_LABELS).map(([gate, label]) => {
            const enabled = (tier?.entitlements ?? []).includes(gate)
            return (
              <div
                key={gate}
                className="flex items-center gap-3 py-2"
              >
                <div
                  className={clsx(
                    "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                    enabled
                      ? "bg-success-100 text-success-700"
                      : "bg-ink-100 text-ink-300",
                  )}
                >
                  {enabled ? (
                    <Check className="w-3 h-3" strokeWidth={3} />
                  ) : (
                    <span className="w-1.5 h-px bg-current" />
                  )}
                </div>
                <div
                  className={clsx(
                    "text-sm flex-1",
                    enabled ? "text-ink-900" : "text-ink-500",
                  )}
                >
                  {label}
                </div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      {tier && (
        <p className="mt-6 text-xs text-ink-500 text-center max-w-2xl mx-auto">
          {tier.base_price_cents === 0 ? (
            "Free forever — no card required."
          ) : (
            <>
              Pro is{" "}
              <span className="font-medium text-ink-700 tabular-nums">
                ${(tier.base_price_cents / 100).toFixed(0)}/mo
              </span>{" "}
              base + ${(tier.metered_per_subscriber_cents / 100).toFixed(2)} per
              subscriber over{" "}
              {tier.max_active_subscribers?.toLocaleString()} (metered via
              Stripe).
            </>
          )}
        </p>
      )}
    </div>
  )
}

function UsageMeter({
  label,
  icon,
  current,
  limit,
}: {
  label: string
  icon: React.ReactNode
  current: number
  limit: number | null
}) {
  const ratio = limit ? Math.min(1, current / limit) : 0
  const overLimit = limit !== null && current >= limit
  const overWarn = limit !== null && current >= limit * 0.8

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xs font-semibold text-ink-500 uppercase tracking-wider">
          {label}
        </div>
        <div className="w-7 h-7 rounded-md bg-ink-100 text-ink-500 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5 mt-3">
        <span className="text-2xl font-bold text-ink-900 tabular-nums tracking-tight">
          {current.toLocaleString()}
        </span>
        <span className="text-xs text-ink-500 tabular-nums">
          /{" "}
          {limit === null ? (
            <InfinityIcon className="w-3 h-3 inline-block" />
          ) : (
            limit.toLocaleString()
          )}
        </span>
      </div>
      {limit !== null && (
        <div className="mt-3 h-1 w-full bg-ink-100 rounded-full overflow-hidden">
          <div
            className={clsx(
              "h-full rounded-full transition-all duration-500",
              overLimit
                ? "bg-danger-500"
                : overWarn
                ? "bg-warning-500"
                : "bg-brand-500",
            )}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
    </Card>
  )
}
