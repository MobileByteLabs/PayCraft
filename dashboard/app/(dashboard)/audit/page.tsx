import { Activity, Download, Filter, Search } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Button, ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"

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

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={
          <>
            Append-only record of every dashboard mutation, webhook event, and
            OAuth flow. Retention follows your tier (
            <span className="capitalize font-medium">{tenant.plan}</span> ={" "}
            <span className="tabular-nums">
              {tenant.plan === "free"
                ? "7"
                : tenant.plan === "pro"
                ? "90"
                : "365"}
            </span>{" "}
            days).
          </>
        }
        actions={
          <ButtonLink
            href="/api/audit/export"
            variant="secondary"
            leading={<Download className="w-4 h-4" strokeWidth={2.5} />}
          >
            Export CSV
          </ButtonLink>
        }
      />

      <Card className="mb-4">
        <CardBody className="!py-3">
          <form
            action="/audit"
            method="get"
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative flex-1 min-w-[280px]">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                strokeWidth={2}
              />
              <input
                name="action"
                defaultValue={searchParams.action ?? ""}
                placeholder="Filter by action (e.g. product.created)..."
                className="input pl-9"
              />
            </div>
            <select
              name="actor"
              defaultValue={searchParams.actor ?? ""}
              className="input w-36"
            >
              <option value="">All actors</option>
              <option value="user">User</option>
              <option value="webhook">Webhook</option>
              <option value="system">System</option>
              <option value="api_key">API key</option>
            </select>
            <select
              name="days"
              defaultValue={searchParams.days ?? "7"}
              className="input w-32"
            >
              <option value="1">Last 24h</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <Button
              type="submit"
              size="sm"
              leading={<Filter className="w-4 h-4" strokeWidth={2} />}
            >
              Apply
            </Button>
          </form>
        </CardBody>
      </Card>

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
        <Card>
          <table className="w-full">
            <thead className="bg-ink-50/60 border-b border-ink-200">
              <tr>
                <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-left w-44">
                  Time
                </th>
                <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-left w-32">
                  Actor
                </th>
                <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-left">
                  Action
                </th>
                <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-left">
                  Resource
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {logs.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-ink-50/40 transition-colors group"
                >
                  <td className="px-5 py-3 align-top">
                    <span className="text-xs text-ink-500 font-mono tabular-nums whitespace-nowrap">
                      {formatTs(row.ts)}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${actorClass(
                        row.actor_type,
                      )}`}
                    >
                      {row.actor_type}
                    </span>
                    {row.actor_user_id && (
                      <span className="ml-1.5 text-xs text-ink-400 font-mono">
                        {row.actor_user_id.slice(0, 6)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span className="text-sm font-semibold text-ink-900">
                      {row.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span className="text-xs text-ink-600 font-mono break-all">
                      {row.resource}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-ink-100 bg-ink-50/30 px-5 py-3 text-xs text-ink-500 flex items-center justify-between">
            <span>
              Showing{" "}
              <span className="tabular-nums font-medium text-ink-700">
                {logs.length}
              </span>{" "}
              events
            </span>
            <span>
              Filter window:{" "}
              <span className="tabular-nums font-medium text-ink-700">
                {days}d
              </span>
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}

function actorClass(actor: string): string {
  switch (actor) {
    case "user":
      return "bg-info-50 text-info-700 border-info-200"
    case "webhook":
      return "bg-ink-100 text-ink-700 border-ink-200"
    case "system":
      return "bg-brand-50 text-brand-700 border-brand-200"
    case "api_key":
      return "bg-warning-50 text-warning-700 border-warning-200"
    default:
      return "bg-ink-100 text-ink-700 border-ink-200"
  }
}

function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toISOString().replace("T", " ").substring(0, 19)
}
