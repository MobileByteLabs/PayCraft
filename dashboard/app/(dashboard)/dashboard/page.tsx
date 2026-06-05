import Link from "next/link"
import {
  Activity,
  CheckCircle2,
  Circle,
  CreditCard,
  KeyRound,
  Package,
  Plug,
  TrendingUp,
  Users,
  Webhook,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody, StatCard } from "@/components/ui/card"
import { Button, ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface ChecklistItem {
  label: string
  href: string
  done: boolean
}

export default async function HomePage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [
    subscribersRes,
    productsRes,
    providersRes,
    paywallRes,
    teamRes,
    auditRes,
    mrrRes,
    webhookRes,
  ] = await Promise.all([
    supabase
      .from("tenant_subscriber_count_view")
      .select("active_count,trial_count,canceled_count")
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
    supabase
      .from("tenant_paywall")
      .select("tenant_id")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tenant_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    supabase
      .from("tenant_audit_log")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("ts", { ascending: false })
      .limit(5),
    supabase
      .from("tenant_mrr_view")
      .select("mrr_dollars")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tenant_webhook_delivery_view")
      .select("success_rate,total")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
  ])

  const activeSubs = subscribersRes.data?.active_count ?? 0
  const trialSubs = subscribersRes.data?.trial_count ?? 0
  const productCount = productsRes.count ?? 0
  const providerCount = providersRes.count ?? 0
  const teamCount = teamRes.count ?? 0
  const auditLog = auditRes.data ?? []
  const mrr = mrrRes.data?.mrr_dollars ?? 0
  const webhookSuccessRate = webhookRes.data?.success_rate ?? 1
  const webhookTotal = webhookRes.data?.total ?? 0

  const checklist: ChecklistItem[] = [
    {
      label: "Create your first product",
      href: "/products/new",
      done: productCount > 0,
    },
    {
      label: "Connect a payment provider",
      href: "/providers",
      done: providerCount > 0,
    },
    {
      label: "Configure paywall design",
      href: "/paywall",
      done: !!paywallRes.data,
    },
    {
      label: "Reveal your API key in the SDK",
      href: "/settings/api-keys",
      done: false,
    },
    {
      label: "Invite a teammate",
      href: "/team",
      done: teamCount > 1,
    },
    {
      label: "Verify a webhook from your provider",
      href: "/webhooks",
      done: webhookTotal > 0,
    },
    {
      label: "Add per-locale pricing",
      href: "/products",
      done: false,
    },
  ]
  const checklistDone = checklist.filter((c) => c.done).length
  const checklistProgress = Math.round(
    (checklistDone / checklist.length) * 100,
  )

  return (
    <div>
      <PageHeader
        title={`Welcome, ${tenant.owner_email.split("@")[0]}`}
        subtitle={
          <>
            <span className="font-medium text-ink-700">{tenant.name}</span> ·{" "}
            <span className="capitalize">{tenant.plan}</span> tier ·{" "}
            <span className="tabular-nums">{activeSubs}</span> active
            subscribers
          </>
        }
      />

      {/* Quick stats */}
      <section className="grid grid-cols-4 gap-4 mb-8 animate-slide-up">
        <StatCard
          label="MRR"
          value={`$${mrr.toFixed(0)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          trend={
            mrr > 0
              ? { value: "+12%", tone: "success" }
              : { value: "Start now", tone: "brand" }
          }
        />
        <StatCard
          label="Active subs"
          value={activeSubs.toLocaleString()}
          icon={<Users className="w-4 h-4" />}
          helper={
            trialSubs > 0 ? (
              <span className="tabular-nums">{trialSubs} trialing</span>
            ) : undefined
          }
        />
        <StatCard
          label="Active products"
          value={productCount}
          icon={<Package className="w-4 h-4" />}
          trend={
            productCount > 0
              ? { value: "Live", tone: "success" }
              : { value: "Empty", tone: "neutral" }
          }
        />
        <StatCard
          label="Webhook success"
          value={`${(webhookSuccessRate * 100).toFixed(1)}%`}
          icon={<Webhook className="w-4 h-4" />}
          trend={{
            value: webhookTotal === 0 ? "—" : "Healthy",
            tone: webhookTotal === 0 ? "neutral" : "success",
          }}
        />
      </section>

      {/* Onboarding checklist */}
      <Card className="mb-8 animate-slide-up">
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              Get the most out of PayCraft
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">
              {checklistDone} of {checklist.length} complete
            </p>
          </div>
          <Badge
            tone={
              checklistDone === checklist.length
                ? "success"
                : checklistDone > 0
                ? "brand"
                : "neutral"
            }
          >
            {checklistProgress}%
          </Badge>
        </div>
        <div className="h-1 w-full bg-ink-100">
          <div
            className="h-full bg-brand-600 transition-all duration-700 ease-out"
            style={{ width: `${checklistProgress}%` }}
          />
        </div>
        <CardBody className="!p-0">
          <ul className="divide-y divide-ink-100">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50/50 group transition-colors"
                >
                  {item.done ? (
                    <CheckCircle2
                      className="w-4 h-4 text-success-600 flex-shrink-0"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <Circle
                      className="w-4 h-4 text-ink-300 flex-shrink-0"
                      strokeWidth={2}
                    />
                  )}
                  <span
                    className={
                      item.done
                        ? "text-sm text-ink-500 line-through"
                        : "text-sm text-ink-900 font-medium flex-1"
                    }
                  >
                    {item.label}
                  </span>
                  {!item.done && (
                    <span className="text-xs text-brand-600 font-medium group-hover:translate-x-0.5 transition-transform">
                      Go →
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Activity + actions */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <Card>
            <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">
                Recent activity
              </h3>
              <Link
                href="/audit"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                View all →
              </Link>
            </div>
            <CardBody className="!p-0">
              {auditLog.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Activity className="w-5 h-5 text-ink-300 mx-auto mb-2" />
                  <p className="text-sm text-ink-500">
                    No activity yet. Once you configure products and
                    providers, this is where every change will show up.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {auditLog.map((row: any) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          row.actor_type === "user"
                            ? "bg-info-50 text-info-700 border-info-200"
                            : row.actor_type === "webhook"
                            ? "bg-ink-100 text-ink-700 border-ink-200"
                            : "bg-brand-50 text-brand-700 border-brand-200"
                        }`}
                      >
                        {row.actor_type}
                      </span>
                      <span className="text-sm font-medium text-ink-900 flex-1 truncate">
                        {row.action}
                      </span>
                      <span className="text-xs text-ink-400 font-mono tabular-nums flex-shrink-0">
                        {relativeTime(row.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <div className="px-5 py-4 border-b border-ink-100">
            <h3 className="text-sm font-semibold text-ink-900">Quick actions</h3>
          </div>
          <CardBody className="space-y-2">
            <ButtonLink
              href="/products/new"
              variant="secondary"
              leading={<Package className="w-4 h-4" />}
              className="w-full justify-start"
            >
              New product
            </ButtonLink>
            <ButtonLink
              href="/providers"
              variant="secondary"
              leading={<Plug className="w-4 h-4" />}
              className="w-full justify-start"
            >
              Connect provider
            </ButtonLink>
            <ButtonLink
              href="/team"
              variant="secondary"
              leading={<Users className="w-4 h-4" />}
              className="w-full justify-start"
            >
              Invite teammate
            </ButtonLink>
            <ButtonLink
              href="/settings/api-keys"
              variant="secondary"
              leading={<KeyRound className="w-4 h-4" />}
              className="w-full justify-start"
            >
              View API keys
            </ButtonLink>
            <ButtonLink
              href="/billing"
              variant="secondary"
              leading={<CreditCard className="w-4 h-4" />}
              className="w-full justify-start"
            >
              Billing & usage
            </ButtonLink>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
