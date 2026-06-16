import Link from "next/link"
import {
  Download,
  Search,
  Filter,
  Users,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ButtonLink } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

type Subscription = {
  id: string
  email: string
  plan: string | null
  provider: string | null
  status: string
  mode: string
  current_period_end: string | null
  created_at: string
  updated_at?: string
}

const PER_PAGE = 25

function planBadgeClass(plan: string | null) {
  const p = (plan ?? "").toLowerCase()
  if (p === "pro")
    return "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
  if (p === "enterprise")
    return "bg-ink-900 text-white"
  return "bg-ink-100 text-ink-500 ring-1 ring-ink-200"
}

function statusBadgeClass(status: string) {
  if (status === "active")
    return "bg-success-50 text-success-700 ring-1 ring-success-200"
  if (status === "trialing")
    return "bg-warning-50 text-warning-700 ring-1 ring-warning-200"
  if (status === "canceled" || status === "cancelled")
    return "bg-danger-50 text-danger-700 ring-1 ring-danger-200"
  return "bg-ink-100 text-ink-500 ring-1 ring-ink-200"
}

function statusLabel(status: string) {
  if (status === "trialing") return "Trial"
  if (status === "canceled" || status === "cancelled") return "Churned"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function planLabel(plan: string | null) {
  if (!plan) return "Free"
  const p = plan.toLowerCase()
  if (p === "pro") return "Pro"
  if (p === "enterprise") return "Enterprise"
  if (p === "free") return "Free"
  return plan
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return "Just now"
  if (m < 60) return `${m} mins ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`
  const d = Math.floor(h / 24)
  if (d === 1) return "Yesterday"
  return `${d} days ago`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function stripUndefined<T extends Record<string, any>>(
  o: T,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k in o) if (o[k] != null && o[k] !== "") out[k] = String(o[k])
  return out
}

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: {
    q?: string
    status?: string
    plan?: string
    provider?: string
    mode?: string
    page?: string
  }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const page = parseInt(searchParams.page ?? "1") || 1
  const offset = (page - 1) * PER_PAGE
  const mode = searchParams.mode ?? "live"

  let query = supabase
    .from("subscriptions")
    .select(
      "id,email,plan,provider,status,mode,current_period_end,created_at,updated_at",
      { count: "exact" },
    )
    .eq("tenant_id", tenant.id)
    .eq("mode", mode)
    .order("updated_at", { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (searchParams.q) query = query.ilike("email", `%${searchParams.q}%`)
  if (searchParams.status) query = query.eq("status", searchParams.status)
  if (searchParams.plan) query = query.eq("plan", searchParams.plan)
  if (searchParams.provider) query = query.eq("provider", searchParams.provider)

  const { data, count } = await query

  // Stats
  const { data: stats } = await supabase
    .from("tenant_subscriber_count_view")
    .select("active_count,trial_count,canceled_count")
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  // MRR stat
  const { data: mrrData } = await supabase
    .from("tenant_mrr_view")
    .select("mrr_dollars")
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE))
  const rows = (data as Subscription[]) ?? []

  const activeCount = stats?.active_count ?? 0
  const trialCount = stats?.trial_count ?? 0
  const churnedCount = stats?.canceled_count ?? 0
  const mrrToday = mrrData?.mrr_dollars ?? 0

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
        <div>
          <h2 className="text-3xl font-extrabold text-ink-900 tracking-tight">
            Subscribers
          </h2>
          <p className="text-ink-500 font-medium mt-1">
            {(count ?? 0).toLocaleString()} subscribers total across all platforms
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Live / Test mode pills */}
          {["live", "test"].map((m) => (
            <Link
              key={m}
              href={`/subscribers?mode=${m}`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                mode === m
                  ? "bg-ink-900 text-white"
                  : "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Link>
          ))}
          <ButtonLink
            href={`/api/subscribers/export?mode=${mode}`}
            variant="secondary"
            leading={<Download className="w-4 h-4" strokeWidth={2.5} />}
          >
            Export CSV
          </ButtonLink>
        </div>
      </section>

      {/* Stats Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:border-success-300 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-ink-500 text-xs font-bold uppercase tracking-wider">
              Active
            </span>
            <div className="w-8 h-8 rounded-lg bg-success-50 flex items-center justify-center text-success-600">
              <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-ink-900">
            {activeCount.toLocaleString()}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-success-600">
            <TrendingUp className="w-3 h-3" />
            +12% this month
          </div>
        </div>

        {/* Churned */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:border-danger-300 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-ink-500 text-xs font-bold uppercase tracking-wider">
              Churned
            </span>
            <div className="w-8 h-8 rounded-lg bg-danger-50 flex items-center justify-center text-danger-600">
              <TrendingDown className="w-4 h-4" strokeWidth={2.5} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-ink-900">
            {churnedCount.toLocaleString()}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-danger-600">
            <TrendingDown className="w-3 h-3" />
            2% churn rate
          </div>
        </div>

        {/* Trial */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:border-warning-300 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-ink-500 text-xs font-bold uppercase tracking-wider">
              Trial
            </span>
            <div className="w-8 h-8 rounded-lg bg-warning-50 flex items-center justify-center text-warning-600">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-extrabold text-ink-900">
            {trialCount.toLocaleString()}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-ink-400">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />
            </svg>
            Expiring soon
          </div>
        </div>

        {/* MRR */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 border-l-4 border-l-brand-600 shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-ink-500 text-xs font-bold uppercase tracking-wider">
              MRR
            </span>
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-extrabold text-ink-900 tabular-nums">
            ${mrrToday.toFixed(0)}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-brand-600">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 2v11h3v9l7-12h-4l4-8z" />
            </svg>
            Growth tracking
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="bg-white p-3 rounded-xl border border-ink-200 shadow-sm flex flex-wrap items-center gap-3">
        <form
          action="/subscribers"
          className="flex flex-wrap items-center gap-3 flex-1"
        >
          <input type="hidden" name="mode" value={mode} />
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" strokeWidth={2} />
            <input
              name="q"
              defaultValue={searchParams.q ?? ""}
              placeholder="Filter by email, ID or name..."
              className="w-full bg-ink-50 border border-ink-200 rounded-lg py-1.5 pl-10 pr-4 text-xs focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={searchParams.status ?? ""}
              className="bg-ink-50 border border-ink-200 rounded-lg py-1.5 px-3 text-xs font-medium focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none transition-all"
            >
              <option value="">Status: All</option>
              <option value="active">Active</option>
              <option value="trialing">Trial</option>
              <option value="canceled">Churned</option>
              <option value="past_due">Past Due</option>
            </select>
            <select
              name="plan"
              defaultValue={searchParams.plan ?? ""}
              className="bg-ink-50 border border-ink-200 rounded-lg py-1.5 px-3 text-xs font-medium focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none transition-all"
            >
              <option value="">Plan: All</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <button
              type="submit"
              className="bg-ink-50 border border-ink-200 rounded-lg py-1.5 px-3 text-xs font-medium text-ink-600 flex items-center gap-1.5 hover:bg-ink-100 transition-colors"
            >
              <Filter className="w-3.5 h-3.5" strokeWidth={2} />
              Filter
            </button>
          </div>
        </form>
      </section>

      {/* Data Table */}
      <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-ink-50/50 border-b border-ink-100">
              <tr>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  App ID
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Email
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Plan
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Status
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Provider
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Period End
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                  Started
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <EmptyState
                      icon={<Users className="w-5 h-5" strokeWidth={2} />}
                      title={
                        searchParams.q ||
                        searchParams.status ||
                        searchParams.plan
                          ? "No subscribers match your filter"
                          : "No subscribers yet"
                      }
                      description={
                        searchParams.q ||
                        searchParams.status ||
                        searchParams.plan
                          ? "Try clearing some filters."
                          : "Subscriptions land here when users complete checkout."
                      }
                    />
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-ink-50/80 transition-colors group"
                >
                  <td className="px-6 py-4 text-[12px] font-mono text-ink-500">
                    {r.id.slice(0, 8)}…
                  </td>
                  <td className="px-6 py-4 text-[13px] font-medium text-ink-900">
                    <Link
                      href={`/subscribers/${r.id}`}
                      className="hover:text-brand-600 transition-colors"
                    >
                      {r.email}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${planBadgeClass(r.plan)}`}
                    >
                      {planLabel(r.plan)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${statusBadgeClass(r.status)}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[12px] text-ink-500 capitalize">
                    {r.provider ?? "—"}
                  </td>
                  <td className="px-6 py-4 text-[13px] text-ink-500">
                    {r.current_period_end
                      ? formatDate(r.current_period_end)
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-[13px] text-ink-500">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/subscribers/${r.id}`}
                      className="text-brand-600 text-xs font-bold hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {rows.length > 0 && (
          <div className="px-6 py-4 border-t border-ink-100 flex items-center justify-between">
            <p className="text-[12px] font-medium text-ink-500">
              Showing{" "}
              <span className="text-ink-900 tabular-nums font-semibold">
                {offset + 1}–{Math.min(offset + PER_PAGE, count ?? 0)}
              </span>{" "}
              of{" "}
              <span className="text-ink-900 tabular-nums font-semibold">
                {(count ?? 0).toLocaleString()}
              </span>{" "}
              subscribers
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={`/subscribers?${new URLSearchParams({
                    ...stripUndefined(searchParams as any),
                    page: String(page - 1),
                  }).toString()}`}
                  className="px-3 py-1.5 border border-ink-200 rounded-lg text-xs font-bold text-ink-700 hover:bg-ink-50 active:scale-95 transition-all flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
                  Previous
                </Link>
              ) : (
                <span className="px-3 py-1.5 border border-ink-200 rounded-lg text-xs font-bold text-ink-300 cursor-not-allowed flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
                  Previous
                </span>
              )}
              <span className="px-2 text-xs text-ink-500 tabular-nums">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/subscribers?${new URLSearchParams({
                    ...stripUndefined(searchParams as any),
                    page: String(page + 1),
                  }).toString()}`}
                  className="px-3 py-1.5 border border-ink-200 rounded-lg text-xs font-bold text-ink-700 hover:bg-ink-50 active:scale-95 transition-all flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                </Link>
              ) : (
                <span className="px-3 py-1.5 border border-ink-200 rounded-lg text-xs font-bold text-ink-300 cursor-not-allowed flex items-center gap-1">
                  Next
                  <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
