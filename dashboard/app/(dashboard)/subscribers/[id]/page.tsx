import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { notFound } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Copy,
  Smartphone,
  Laptop,
  Monitor,
  Ban,
  CreditCard,
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  PlusCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"

// ── helpers ─────────────────────────────────────────────────────────────────

function planTone(plan: string | null): "brand" | "neutral" | "success" {
  const p = (plan ?? "").toLowerCase()
  if (p === "pro") return "brand"
  if (p === "enterprise") return "success"
  return "neutral"
}

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success"
  if (status === "trialing") return "warning"
  if (status === "canceled" || status === "cancelled") return "danger"
  return "neutral"
}

function statusLabel(status: string) {
  if (status === "trialing") return "Trial"
  if (status === "canceled" || status === "cancelled") return "Churned"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function planLabel(plan: string | null) {
  if (!plan) return "Free"
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function fmt(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
  })
}

function relativeAgo(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return "Just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return "Yesterday"
  return `${d}d ago`
}

function DeviceIcon({ platform }: { platform: string }) {
  const p = (platform ?? "").toLowerCase()
  if (p === "ios" || p === "iphone" || p.includes("iphone"))
    return <Smartphone className="w-5 h-5" strokeWidth={1.5} />
  if (p === "android") return <Smartphone className="w-5 h-5" strokeWidth={1.5} />
  if (p === "macos" || p === "mac" || p.includes("mac"))
    return <Laptop className="w-5 h-5" strokeWidth={1.5} />
  return <Monitor className="w-5 h-5" strokeWidth={1.5} />
}

// ── transaction mock type ─────────────────────────────────────────────────

type TxEvent = {
  id: string
  type: "upgrade" | "renewal" | "initial" | "refund"
  label: string
  amount: number
  date: string
}

// ── page ──────────────────────────────────────────────────────────────────

export default async function SubscriberDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()

  if (!sub) notFound()

  // Fetch devices for this subscriber
  const { data: devices } = await supabase
    .from("registered_devices")
    .select("*")
    .eq("tenant_id", tenant.id)
    .ilike("email", sub.email)
    .order("last_seen_at", { ascending: false })

  // TODO: wire Supabase — fetch subscription_events / payment_events table
  const txEvents: TxEvent[] = []

  const mrr =
    sub.plan === "enterprise"
      ? 499
      : sub.plan === "pro"
        ? 29
        : 0

  const trialUsed = sub.trial_end
    ? Math.max(
        0,
        Math.floor(
          (new Date(sub.trial_end).getTime() -
            new Date(sub.created_at).getTime()) /
            86400000,
        ),
      )
    : 0

  const trialMax = 14

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 pt-2">
        <div className="flex items-center gap-4">
          <Link
            href="/subscribers"
            className="w-10 h-10 rounded-lg border border-ink-200 flex items-center justify-center text-ink-600 hover:bg-ink-50 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </Link>
          <div>
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <h2 className="text-2xl font-bold text-ink-900 tracking-tight">
                {sub.email}
              </h2>
              <div className="flex gap-2">
                <Badge tone={planTone(sub.plan)}>{planLabel(sub.plan)}</Badge>
                <Badge tone={statusTone(sub.status)} dot={sub.status === "active"}>
                  {statusLabel(sub.status)}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-ink-500">
              Created {fmt(sub.created_at)} •{" "}
              {sub.updated_at
                ? `Last updated ${relativeAgo(sub.updated_at)}`
                : "—"}
            </p>
          </div>
        </div>
        <div>
          <button className="flex items-center gap-2 bg-white text-danger-600 px-4 py-2 rounded-lg border border-danger-200 text-sm font-semibold hover:bg-danger-50 active:opacity-80 transition-all">
            <Ban className="w-4 h-4" strokeWidth={2} />
            Revoke access
          </button>
        </div>
      </div>

      {/* Two-Column Bento Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column — 60% */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {/* Subscription Details Card */}
          <div className="bg-white rounded-xl border border-ink-200 p-6 relative overflow-hidden shadow-sm">
            <div className="absolute top-0 left-0 w-1 h-full bg-brand-600 rounded-l-xl" />
            <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest mb-6">
              Subscription Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-12">
              <div>
                <p className="text-xs text-ink-500 mb-1">Plan</p>
                <p className="text-sm font-semibold text-ink-900 flex items-center gap-2">
                  {planLabel(sub.plan)} Subscription
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-600 inline-block" />
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1">Monthly Recurring Revenue</p>
                <p className="text-sm font-bold text-ink-900 tabular-nums">
                  ${mrr.toFixed(2)} / mo
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1">Started</p>
                <p className="text-sm font-semibold text-ink-900">
                  {fmt(sub.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1">Next Renewal</p>
                <p className="text-sm font-semibold text-ink-900">
                  {fmt(sub.current_period_end)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1">Trial Days Used</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm font-bold text-ink-900 tabular-nums">
                    {trialUsed}
                  </span>
                  <div className="flex-1 bg-ink-100 h-1.5 rounded-full overflow-hidden max-w-[100px]">
                    <div
                      className="bg-ink-300 h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (trialUsed / trialMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1">Provider</p>
                <p className="text-sm font-semibold text-ink-900 capitalize">
                  {sub.provider ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Transaction History */}
          <div className="bg-white rounded-xl border border-ink-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest">
                Transfer history
              </h3>
              <button className="text-[11px] font-bold text-brand-600 hover:underline uppercase tracking-tight">
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/50">
                    <th className="px-6 py-3 text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                      Event
                    </th>
                    <th className="px-6 py-3 text-[11px] font-bold text-ink-400 uppercase tracking-wider text-right">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-[11px] font-bold text-ink-400 uppercase tracking-wider text-right">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {/* TODO: wire Supabase — replace with real txEvents */}
                  {txEvents.length === 0 && (
                    <>
                      <TransactionRow
                        icon={
                          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600">
                            <ArrowUpCircle className="w-4 h-4" strokeWidth={2} />
                          </div>
                        }
                        label="Subscription upgrade"
                        amount={mrr}
                        date="Just now"
                      />
                      <TransactionRow
                        icon={
                          <div className="w-8 h-8 rounded-lg bg-success-50 flex items-center justify-center text-success-600">
                            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                          </div>
                        }
                        label="Renewal payment"
                        amount={mrr}
                        date={fmt(sub.current_period_end)}
                      />
                      <TransactionRow
                        icon={
                          <div className="w-8 h-8 rounded-lg bg-ink-100 flex items-center justify-center text-ink-500">
                            <PlusCircle className="w-4 h-4" strokeWidth={2} />
                          </div>
                        }
                        label="Initial charge"
                        amount={mrr}
                        date={fmt(sub.created_at)}
                      />
                    </>
                  )}
                  {txEvents.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      icon={
                        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600">
                          <CreditCard className="w-4 h-4" strokeWidth={2} />
                        </div>
                      }
                      label={tx.label}
                      amount={tx.amount}
                      date={tx.date}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column — 40% */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Device List */}
          <div className="bg-white rounded-xl border border-ink-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest">
                Devices
              </h3>
              <span className="text-[11px] bg-ink-100 px-2 py-0.5 rounded text-ink-500 font-bold">
                {(devices?.length ?? 0)} Linked
              </span>
            </div>
            <div className="p-2 space-y-1">
              {(!devices || devices.length === 0) && (
                <p className="px-4 py-6 text-sm text-ink-400 text-center">
                  No devices registered
                </p>
              )}
              {(devices ?? []).map((d: any) => (
                <div
                  key={d.id}
                  className="p-4 rounded-lg hover:bg-ink-50 transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-ink-50 border border-ink-100 flex items-center justify-center text-ink-400 group-hover:bg-white transition-colors">
                      <DeviceIcon platform={d.platform ?? ""} />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-bold text-ink-900">
                        {d.device_name || d.platform || "Unknown device"}
                      </h4>
                      <p className="text-[11px] text-ink-500">
                        {d.platform} •{" "}
                        {d.last_seen_at
                          ? `Seen ${relativeAgo(d.last_seen_at)}`
                          : "Never seen"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      d.is_active
                        ? "bg-success-50 text-success-700 border-success-100"
                        : "bg-ink-100 text-ink-400 border-ink-200"
                    }`}
                  >
                    {d.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* App Details */}
          <div className="bg-white rounded-xl border border-ink-200 p-6 shadow-sm">
            <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest mb-6">
              App details
            </h3>
            <div className="space-y-4">
              <AppDetailRow
                label="Subscription ID"
                value={sub.provider_subscription_id ?? sub.id}
                copyable
              />
              <AppDetailRow
                label="Customer ID"
                value={sub.provider_customer_id ?? "—"}
                copyable={!!sub.provider_customer_id}
              />
              <div>
                <label className="text-[11px] font-bold text-ink-400 uppercase tracking-wider block mb-1">
                  Provider
                </label>
                <p className="text-[13px] font-medium text-ink-900 capitalize">
                  {sub.provider ?? "—"}
                </p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink-400 uppercase tracking-wider block mb-1">
                  Mode
                </label>
                <p className="text-[13px] font-medium text-ink-900 capitalize flex items-center gap-2">
                  {sub.mode ?? "live"}
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      sub.mode === "live"
                        ? "bg-success-500"
                        : "bg-warning-400"
                    }`}
                  />
                </p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink-400 uppercase tracking-wider block mb-1">
                  Cancel at Period End
                </label>
                <p className="text-[13px] font-medium text-ink-900">
                  {sub.cancel_at_period_end ? "Yes" : "No"}
                </p>
              </div>
            </div>
          </div>

          {/* SDK Promo Banner */}
          <div className="relative bg-ink-900 rounded-xl p-6 overflow-hidden h-36 flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-900/40 via-ink-900 to-ink-900" />
            <div className="relative z-10 text-center">
              <p className="text-ink-400 text-[10px] font-bold uppercase tracking-widest mb-2">
                Kotlin Multiplatform SDK
              </p>
              <h4 className="text-white text-lg font-bold">
                Ready for Production
              </h4>
              <p className="text-ink-500 text-xs mt-1">v3.0.0-beta incoming</p>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-transparent to-transparent" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────

function TransactionRow({
  icon,
  label,
  amount,
  date,
}: {
  icon: React.ReactNode
  label: string
  amount: number
  date: string
}) {
  return (
    <tr className="hover:bg-ink-50 transition-colors group">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-[13px] font-medium text-ink-900">{label}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <span className="text-[13px] font-bold text-ink-900 tabular-nums">
          ${amount.toFixed(2)}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <span className="text-[13px] text-ink-500">{date}</span>
      </td>
    </tr>
  )
}

function AppDetailRow({
  label,
  value,
  copyable = false,
}: {
  label: string
  value: string
  copyable?: boolean
}) {
  return (
    <div>
      <label className="text-[11px] font-bold text-ink-400 uppercase tracking-wider block mb-1">
        {label}
      </label>
      <div className="flex items-center justify-between gap-2 p-2 bg-ink-50 rounded border border-ink-100 group">
        <code className="text-xs text-ink-600 font-mono truncate">{value}</code>
        {copyable && (
          <button className="text-ink-400 hover:text-brand-600 transition-colors flex-shrink-0">
            <Copy className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
