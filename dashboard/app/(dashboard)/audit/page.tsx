import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { action?: string; days?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const days = parseInt(searchParams.days ?? "7")
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
  const { data: logs } = await q

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
      <p className="text-sm text-gray-500 mb-6">
        Append-only record of every dashboard mutation, webhook event, and OAuth
        flow. Retention follows your tier ({tenant.plan}).
      </p>

      <form
        className="flex flex-wrap gap-2 mb-4 text-sm"
        action="/audit"
        method="get"
      >
        <input
          name="action"
          defaultValue={searchParams.action ?? ""}
          placeholder="filter by action (e.g. product.created)"
          className="border border-gray-300 rounded px-3 py-1.5 w-72"
        />
        <select
          name="days"
          defaultValue={searchParams.days ?? "7"}
          className="border border-gray-300 rounded px-2 py-1.5"
        >
          <option value="1">Last 24h</option>
          <option value="7">Last 7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
        <button
          type="submit"
          className="rounded bg-brand-600 text-white px-4 py-1.5 font-medium"
        >
          Apply
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2">
                Time
              </th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2">
                Actor
              </th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2">
                Action
              </th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2">
                Resource
              </th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((row: any) => (
              <tr
                key={row.id}
                className="border-b border-gray-100 text-sm align-top"
              >
                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                  {new Date(row.ts).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded uppercase">
                    {row.actor_type}
                  </span>
                  {row.actor_user_id && (
                    <span className="ml-2 font-mono text-xs text-gray-500">
                      {row.actor_user_id.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-medium text-gray-900">
                  {row.action}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-gray-600">
                  {row.resource}
                </td>
              </tr>
            ))}
            {(!logs || logs.length === 0) && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  No audit log entries for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
