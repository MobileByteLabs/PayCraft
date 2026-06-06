import { Activity, Download, Info, ChevronRight, Search } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ButtonLink } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { clsx } from "clsx"

interface AuditRow {
  id: string
  ts: string
  actor_user_id: string | null
  actor_type: string
  action: string
  resource: string
  before_jsonb: any
  after_jsonb: any
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { action?: string; days?: string; actor?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const days = parseInt(searchParams.days ?? "7") || 7
  const since = new Date(Date.now() - days * 86400000).toISOString()
  let q = supabase
    .from("tenant_audit_log")
    .select("*")
    .eq("tenant_id", tenant.id)
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(200)
  if (searchParams.action) {
    q = q.ilike("action", `%${searchParams.action}%`)
  }
  if (searchParams.actor) {
    q = q.eq("actor_type", searchParams.actor)
  }
  const { data } = await q
  const logs: AuditRow[] = (data as AuditRow[]) ?? []

  const retentionDays =
    tenant.plan === "free" ? "7" : tenant.plan === "pro" ? "90" : "365"

  return (
    <div>
      <div className="flex justify-between items-start mb-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">
            Audit log
          </h1>
          <p className="mt-2 text-ink-500 text-base leading-relaxed">
            Append-only record of every dashboard mutation, webhook event, and
            OAuth flow. Retention follows your tier (
            <span className="capitalize font-medium">{tenant.plan}</span> ={" "}
            <span className="tabular-nums">{retentionDays}</span> days).
          </p>
        </div>
        <ButtonLink
          href="/api/audit/export"
          variant="secondary"
          leading={<Download className="w-4 h-4" strokeWidth={2.5} />}
        >
          Export CSV
        </ButtonLink>
      </div>

      {/* Filters Card */}
      <div className="bg-white border border-ink-200 rounded-xl p-4 mb-6 shadow-sm flex flex-wrap items-center gap-4">
        <form
          action="/audit"
          method="get"
          className="flex flex-wrap items-center gap-4 w-full"
        >
          <div className="relative min-w-[300px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              name="action"
              defaultValue={searchParams.action ?? ""}
              placeholder="Filter by action..."
              className="w-full bg-ink-50 border border-ink-200 rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
            />
          </div>
          <select
            name="days"
            defaultValue={searchParams.days ?? "7"}
            className="px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm text-ink-600 hover:bg-ink-50 transition-colors"
          >
            <option value="1">Last 24h</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select
            name="actor"
            defaultValue={searchParams.actor ?? ""}
            className="px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm text-ink-600 hover:bg-ink-50 transition-colors"
          >
            <option value="">All actors</option>
            <option value="user">User</option>
            <option value="webhook">Webhook</option>
            <option value="system">System</option>
            <option value="api_key">API key</option>
          </select>
          {searchParams.actor && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 border border-brand-100 rounded-full text-xs font-semibold text-brand-700">
              actor: {searchParams.actor}
            </div>
          )}
        </form>
      </div>

      {/* Audit Log Table */}
      {logs.length === 0 ? (
        <EmptyState
          icon={<Activity className="w-5 h-5" />}
          title="No audit events for this filter"
          description={
            searchParams.action || searchParams.actor
              ? "Try widening your filter or extending the time range."
              : "Once you start configuring products and connecting providers, every event will land here."
          }
        />
      ) : (
        <div className="bg-white border border-ink-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-ink-50/50 border-b border-ink-200">
                  <th className="text-left px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="text-left px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                    Actor
                  </th>
                  <th className="text-left px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="text-left px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {logs.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-ink-50/80 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 text-[13px] text-ink-500 whitespace-nowrap font-mono">
                      {formatTs(row.ts)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ring-1 ring-inset",
                            actorClass(row.actor_type),
                          )}
                        >
                          {row.actor_type}
                        </span>
                        {row.actor_user_id && (
                          <span className="text-[13px] text-ink-600 font-medium">
                            {row.actor_user_id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[13px] text-ink-900 font-medium">
                        {row.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-[12px] font-mono text-ink-500 bg-ink-100 px-1.5 py-0.5 rounded">
                        {row.resource}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="w-4 h-4 text-ink-300 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Footer */}
          <div className="px-6 py-4 border-t border-ink-100 flex items-center justify-between">
            <span className="text-[13px] text-ink-500 font-medium">
              Showing{" "}
              <span className="text-ink-900">{logs.length}</span> events
            </span>
            <div className="flex gap-2">
              <button
                disabled
                className="px-4 py-2 border border-ink-200 rounded-lg text-sm font-semibold text-ink-400 cursor-not-allowed bg-ink-50 transition-all"
              >
                Previous
              </button>
              <button className="px-4 py-2 border border-ink-200 rounded-lg text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-all">
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-8 flex justify-center">
        <div className="flex items-center gap-2 text-ink-400">
          <Info className="w-4 h-4" />
          <span className="text-xs font-medium">
            Logs are cryptographically signed and immutable.
          </span>
        </div>
      </div>
    </div>
  )
}

function actorClass(actor: string): string {
  switch (actor) {
    case "user":
      return "bg-blue-50 text-blue-700 ring-blue-700/10"
    case "webhook":
      return "bg-ink-100 text-ink-700 ring-ink-700/10"
    case "system":
      return "bg-purple-50 text-purple-700 ring-purple-700/10"
    case "api_key":
      return "bg-warning-50 text-warning-700 ring-warning-700/10"
    default:
      return "bg-ink-100 text-ink-700 ring-ink-700/10"
  }
}

function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toISOString().replace("T", " ").substring(0, 19)
}
