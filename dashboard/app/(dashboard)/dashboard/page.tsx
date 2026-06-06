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
  PlusCircle,
  RefreshCw,
  UserPlus,
  LayoutDashboard,
  XCircle,
  CreditCard as CreditCardIcon,
  ChevronRight,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"
import { ButtonLink } from "@/components/ui/button"

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
        title={`Welcome back, ${tenant.owner_email.split("@")[0]}`}
        subtitle={
          <>
            <span className="font-medium text-ink-700">{tenant.name}</span> ·{" "}
            <span className="capitalize">{tenant.plan}</span> tier ·{" "}
            <span className="tabular-nums">{activeSubs}</span> active
            subscribers
          </>
        }
      />

      {/* Stats Grid — 4 cards matching Stitch design */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-slide-up">
        {/* MRR */}
        <div className="bg-white border border-ink-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-bold text-ink-500 uppercase tracking-wider">MRR</p>
            <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {mrr > 0 ? "+12%" : "Start now"}
            </span>
          </div>
          <h3 className="text-3xl font-bold text-ink-900 tracking-tight">${mrr.toFixed(0)}</h3>
        </div>

        {/* Active Subs */}
        <div className="bg-white border border-ink-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-bold text-ink-500 uppercase tracking-wider">Active subs</p>
            {trialSubs > 0 ? (
              <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                <Users className="w-3 h-3" />
                {trialSubs} trialing
              </span>
            ) : (
              <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                <Users className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
          <h3 className="text-3xl font-bold text-ink-900 tracking-tight">{activeSubs.toLocaleString()}</h3>
        </div>

        {/* Active Products */}
        <div className="bg-white border border-ink-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-bold text-ink-500 uppercase tracking-wider">Products</p>
            <span className={`px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${productCount > 0 ? "text-emerald-600 bg-emerald-50" : "text-ink-500 bg-ink-100"}`}>
              <Package className="w-3 h-3" />
              {productCount > 0 ? "Live" : "Empty"}
            </span>
          </div>
          <h3 className="text-3xl font-bold text-ink-900 tracking-tight">{productCount}</h3>
        </div>

        {/* Webhook Success */}
        <div className="bg-white border border-ink-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-bold text-ink-500 uppercase tracking-wider">Webhook success</p>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${webhookTotal > 0 ? "bg-emerald-500 animate-pulse" : "bg-ink-300"}`} />
            </div>
          </div>
          <h3 className="text-3xl font-bold text-ink-900 tracking-tight">
            {webhookTotal === 0 ? "—" : `${(webhookSuccessRate * 100).toFixed(1)}%`}
          </h3>
        </div>
      </section>

      {/* Onboarding Checklist */}
      <div className="bg-white border border-ink-200 rounded-xl shadow-sm mb-8 overflow-hidden animate-slide-up">
        <div className="p-6 border-b border-ink-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-ink-900">Get the most out of PayCraft</h3>
              <span className="bg-ink-100 text-ink-500 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                {checklistDone} of {checklist.length} complete
              </span>
            </div>
            <div className="mt-3 w-64 h-2 bg-ink-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-600 transition-all duration-1000"
                style={{ width: `${checklistProgress}%` }}
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-2 p-6">
          {checklist.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center justify-between group py-2"
            >
              <div className="flex items-center gap-3">
                {item.done ? (
                  <div className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center text-white flex-shrink-0">
                    <CheckCircle2 className="w-3 h-3" strokeWidth={3} />
                  </div>
                ) : (
                  <div className="w-5 h-5 border-2 border-ink-200 rounded-full flex-shrink-0" />
                )}
                <span
                  className={
                    item.done
                      ? "text-sm text-ink-400 line-through font-medium"
                      : "text-sm text-ink-700 font-medium"
                  }
                >
                  {item.label}
                </span>
              </div>
              {!item.done && (
                <span className="text-brand-600 text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0">
                  Go →
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* Two Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-8 bg-white border border-ink-200 rounded-xl shadow-sm">
          <div className="p-6 border-b border-ink-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-500 uppercase tracking-wider">Recent Activity</h3>
            <Link
              href="/audit"
              className="text-xs font-bold text-brand-600 hover:underline"
            >
              View All Audit Logs
            </Link>
          </div>
          {auditLog.length === 0 ? (
            <div className="p-8 text-center">
              <Activity className="w-5 h-5 text-ink-300 mx-auto mb-2" />
              <p className="text-sm text-ink-500">
                No activity yet. Once you configure products and providers,
                every change will show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-ink-100">
              {auditLog.map((row: any) => (
                <div key={row.id} className="p-4 flex items-center justify-between hover:bg-ink-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      row.actor_type === "user"
                        ? "bg-blue-50 text-blue-600"
                        : row.actor_type === "webhook"
                        ? "bg-ink-100 text-ink-600"
                        : "bg-brand-50 text-brand-600"
                    }`}>
                      {row.actor_type === "user" ? (
                        <UserPlus className="w-4 h-4" />
                      ) : row.actor_type === "webhook" ? (
                        <Webhook className="w-4 h-4" />
                      ) : (
                        <Activity className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{row.action}</p>
                      <p className="text-xs text-ink-500 font-medium capitalize">{row.actor_type}</p>
                    </div>
                  </div>
                  <span className="text-xs text-ink-400 font-medium flex-shrink-0">
                    {relativeTime(row.ts)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions + CTA */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-ink-200 rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-bold text-ink-500 uppercase tracking-wider mb-6">Quick Actions</h3>
            <div className="grid grid-cols-1 gap-3">
              <Link
                href="/products/new"
                className="w-full flex items-center gap-3 px-4 py-3 bg-ink-50 hover:bg-ink-100 border border-ink-200 rounded-lg text-sm font-semibold transition-all group"
              >
                <Package className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span className="text-ink-900 flex-1">New product</span>
                <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
              <Link
                href="/providers"
                className="w-full flex items-center gap-3 px-4 py-3 bg-ink-50 hover:bg-ink-100 border border-ink-200 rounded-lg text-sm font-semibold transition-all group"
              >
                <Plug className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span className="text-ink-900 flex-1">Connect another provider</span>
                <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
              <Link
                href="/team"
                className="w-full flex items-center gap-3 px-4 py-3 bg-ink-50 hover:bg-ink-100 border border-ink-200 rounded-lg text-sm font-semibold transition-all group"
              >
                <UserPlus className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span className="text-ink-900 flex-1">Invite teammate</span>
                <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
              <Link
                href="/paywall"
                className="w-full flex items-center gap-3 px-4 py-3 bg-ink-50 hover:bg-ink-100 border border-ink-200 rounded-lg text-sm font-semibold transition-all group"
              >
                <LayoutDashboard className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span className="text-ink-900 flex-1">Test paywall</span>
                <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
            </div>
          </div>

          {/* Mini CTA Card */}
          <div className="bg-brand-600 rounded-xl p-6 text-white relative overflow-hidden group">
            <div className="relative z-10">
              <h4 className="font-bold text-lg leading-tight mb-2">Automate your reporting</h4>
              <p className="text-brand-100 text-xs mb-4 leading-relaxed">
                Send weekly performance summaries directly to your Slack channel.
              </p>
              <button className="bg-white text-brand-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-brand-50 transition-colors">
                Configure Slack
              </button>
            </div>
            <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
              <TrendingUp className="w-32 h-32" />
            </div>
          </div>
        </div>
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
