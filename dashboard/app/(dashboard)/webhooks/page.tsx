import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import type { WebhookLog } from "@/lib/types"

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const page = parseInt(searchParams.page || "1")
  const perPage = 50
  const offset = (page - 1) * perPage

  let query = supabase
    .from("webhook_logs")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1)

  if (searchParams.status) {
    query = query.eq("status", searchParams.status)
  }

  const { data: logs, count } = await query

  const totalPages = Math.ceil((count ?? 0) / perPage)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhook Events</h1>
          <p className="text-sm text-gray-500 mt-1">{count ?? 0} events logged</p>
        </div>
        <div className="flex gap-2">
          <FilterLink href="/webhooks" label="All" active={!searchParams.status} />
          <FilterLink href="/webhooks?status=success" label="Success" active={searchParams.status === "success"} />
          <FilterLink href="/webhooks?status=failed" label="Failed" active={searchParams.status === "failed"} />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {(!logs || logs.length === 0) ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No webhook events yet
                </td>
              </tr>
            ) : (
              logs.map((log: WebhookLog) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-900">{log.event_type}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{log.provider}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      log.status === "success"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}>
                      {log.status}
                    </span>
                    {log.error_message && (
                      <p className="mt-1 text-xs text-red-600 max-w-xs truncate">{log.error_message}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{(log as any).mode || "live"}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {(log as any).processing_ms ? `${(log as any).processing_ms}ms` : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          {page > 1 && (
            <a href={`/webhooks?page=${page - 1}`} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50">Previous</a>
          )}
          <span className="px-3 py-1.5 text-sm text-gray-600">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`/webhooks?page=${page + 1}`} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50">Next</a>
          )}
        </div>
      )}
    </div>
  )
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`px-3 py-1.5 text-sm rounded-lg border ${
        active ? "bg-brand-50 border-brand-300 text-brand-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
    </a>
  )
}
