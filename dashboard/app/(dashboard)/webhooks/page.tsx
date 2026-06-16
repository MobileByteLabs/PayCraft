import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import type { WebhookLog } from "@/lib/types"
import { Plus, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

/**
 * Per-provider webhook setup hints. Each entry is one collapsible
 * `<details>` block on the page. Adding a new provider only needs
 * a new row here — the URL template, events list, secret-source
 * pointer, and test-event hint render automatically.
 */
const WEBHOOK_SETUP: Record<
  string,
  {
    label: string
    fnPath: string
    events: string[]
    secretSource: string
    testEvent: string
  }
> = {
  stripe: {
    label: "Stripe",
    fnPath: "stripe-webhook",
    events: [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ],
    secretSource:
      "Dashboard → Developers → Webhooks → your endpoint → Signing secret (whsec_…).",
    testEvent:
      "Send `customer.subscription.created` from the Stripe dashboard's `Send test webhook` button.",
  },
  razorpay: {
    label: "Razorpay",
    fnPath: "razorpay-webhook",
    events: [
      "subscription.activated",
      "subscription.charged",
      "subscription.cancelled",
      "payment.captured",
      "payment.failed",
    ],
    secretSource:
      "Dashboard → Settings → Webhooks → your endpoint → Secret (the value you set when creating it).",
    testEvent:
      "Razorpay does not have a built-in tester — capture a ₹1 test payment to fire `payment.captured`.",
  },
  cashfree: {
    label: "Cashfree",
    fnPath: "cashfree-webhook",
    events: [
      "SUBSCRIPTION_NEW",
      "SUBSCRIPTION_ACTIVE",
      "SUBSCRIPTION_CANCELLED",
      "PAYMENT_SUCCESS_WEBHOOK",
    ],
    secretSource:
      "Merchant Dashboard → Developers → Webhooks → your endpoint → Verification Key.",
    testEvent:
      "Use Cashfree's Postman collection or the Developers → Webhooks → `Send Test` button.",
  },
}

function WebhookSetupSection({
  tenantId,
  cloudUrl,
  providers,
}: {
  tenantId: string
  cloudUrl: string
  providers: string[]
}) {
  const known = providers.filter((p) => WEBHOOK_SETUP[p])
  if (known.length === 0) return null

  return (
    <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-ink-100">
        <h3 className="text-xs font-bold text-ink-900 uppercase tracking-wider">
          Setup instructions
        </h3>
        <p className="text-xs text-ink-500 mt-1">
          Register one webhook per provider so PayCraft Cloud stays in sync with
          subscription + payment events.
        </p>
      </div>
      <div className="divide-y divide-ink-100">
        {known.map((p) => {
          const cfg = WEBHOOK_SETUP[p]
          const url = `${cloudUrl}/functions/v1/${cfg.fnPath}/${tenantId}`
          return (
            <details key={p} className="p-4 group">
              <summary className="cursor-pointer flex items-center justify-between">
                <span className="text-sm font-semibold text-ink-900">
                  {cfg.label}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide bg-ink-100 text-ink-500 border border-ink-200 px-2 py-0.5 rounded group-open:hidden">
                  Show
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide bg-brand-50 text-brand-700 border border-brand-100 px-2 py-0.5 rounded hidden group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
                    Endpoint URL
                  </div>
                  <code className="block bg-ink-50 px-3 py-2 rounded text-[12px] font-mono break-all">
                    {url}
                  </code>
                  <p className="text-[11px] text-ink-500 mt-1">
                    Paste this into your {cfg.label} dashboard as the webhook
                    endpoint. The tenant ID at the end scopes events to this
                    app.
                  </p>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
                    Events to subscribe
                  </div>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {cfg.events.map((e) => (
                      <li
                        key={e}
                        className="text-[12px] font-mono bg-ink-50/70 border border-ink-100 rounded px-2 py-1"
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
                    Signing secret
                  </div>
                  <p className="text-[12px] text-ink-700">{cfg.secretSource}</p>
                  <p className="text-[11px] text-ink-500 mt-1">
                    Store the secret in PayCraft via{" "}
                    <Link
                      href="/settings/api-keys"
                      className="text-brand-700 hover:underline"
                    >
                      Settings → API keys
                    </Link>{" "}
                    so the Edge Function can verify incoming signatures.
                  </p>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
                    Send a test event
                  </div>
                  <p className="text-[12px] text-ink-700">{cfg.testEvent}</p>
                </div>
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string; event?: string }
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

  const successCount = (logs ?? []).filter((l: WebhookLog) => l.status === "success").length
  const failedCount = (logs ?? []).filter((l: WebhookLog) => l.status === "failed").length

  // Active providers for this tenant — drives which setup-instructions
  // sections render below. Falls back to the full set if the query fails
  // (e.g. fresh project with no rows yet) so onboarding still sees hints.
  const { data: providerRows } = await supabase
    .from("tenant_providers")
    .select("provider")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
  const activeProviders =
    providerRows && providerRows.length > 0
      ? Array.from(new Set(providerRows.map((r: any) => r.provider as string)))
      : ["stripe", "razorpay", "cashfree"]
  const cloudUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Webhooks</h2>
          <p className="text-ink-500 text-sm mt-1">Monitor provider events in real-time.</p>
        </div>
        <button className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all shadow-sm active:scale-95 w-fit">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Add endpoint
        </button>
      </div>

      {/* Endpoints Section */}
      <section>
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-xs font-bold text-ink-900 uppercase tracking-wider">Endpoints</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Endpoint Card */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-ink-200 p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-600/5 rounded-full -mr-16 -mt-16 blur-3xl pointer-events-none" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-ink-50 rounded-xl flex items-center justify-center border border-ink-100 flex-shrink-0">
                  <svg className="w-5 h-5 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-mono text-[13px] font-semibold text-ink-900">
                      https://api.myapp.com/paycraft
                    </h4>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-success-50 text-success-700 border border-success-100">
                      Active
                    </span>
                  </div>
                  <p className="text-xs text-ink-500 mt-1">Last delivery 2 min ago · v2024-03-01</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button className="px-3 py-1.5 text-xs font-semibold text-ink-600 border border-ink-200 rounded-lg hover:bg-ink-50 transition-colors">
                  Edit
                </button>
                <button className="px-3 py-1.5 text-xs font-semibold text-danger-600 border border-danger-100 rounded-lg hover:bg-danger-50 transition-colors">
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Reliability Stats Card */}
          <div className="bg-ink-900 rounded-xl p-6 text-white flex flex-col justify-between shadow-xl">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold uppercase tracking-widest text-ink-400">Reliability</span>
              <span className="text-success-400 text-xs font-bold flex items-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                  <polyline points="16 7 22 7 22 13" />
                </svg>
                99.98%
              </span>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold tracking-tight">12.4k</div>
              <p className="text-xs text-ink-500 mt-1">Events sent last 24h</p>
            </div>
            <div className="mt-4 h-1.5 w-full bg-ink-800 rounded-full overflow-hidden">
              <div className="h-full bg-brand-600 w-[90%]" />
            </div>
          </div>
        </div>
      </section>

      {/* Per-provider setup hints — AC-34 */}
      <WebhookSetupSection
        tenantId={tenant.id}
        cloudUrl={cloudUrl}
        providers={activeProviders}
      />

      {/* Delivery Log */}
      <section>
        <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          {/* Filter Bar */}
          <div className="p-4 border-b border-ink-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="relative max-w-sm flex-1">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  className="block w-full pl-9 pr-3 py-2 border border-ink-200 rounded-lg text-sm bg-ink-50/30 focus:ring-2 focus:ring-brand-600/10 focus:border-brand-600 transition-all outline-none"
                  placeholder="Search events..."
                  type="text"
                />
              </div>
              <Link
                href="/webhooks"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  !searchParams.status
                    ? "bg-brand-50 border-brand-200 text-brand-700"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                All Status
              </Link>
              <Link
                href="/webhooks?status=success"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  searchParams.status === "success"
                    ? "bg-success-50 border-success-200 text-success-700"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                Success
              </Link>
              <Link
                href="/webhooks?status=failed"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  searchParams.status === "failed"
                    ? "bg-danger-50 border-danger-200 text-danger-700"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                Failed
              </Link>
            </div>
            <button className="flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 font-medium whitespace-nowrap">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/50">
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100">Event type</th>
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100">Status</th>
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100">Provider</th>
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100">Timestamp</th>
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100">Duration</th>
                  <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold border-b border-ink-100 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {(!logs || logs.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-ink-400">
                        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                        <p className="text-sm font-medium text-ink-500">No webhook events yet</p>
                        <p className="text-xs text-ink-400">Events will appear here once you set up an endpoint.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log: WebhookLog) => (
                    <tr key={log.id} className="hover:bg-ink-50/80 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            log.status === "success" ? "bg-brand-600" : "bg-danger-400"
                          }`} />
                          <code className="text-[13px] font-semibold text-ink-900">{log.event_type}</code>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {log.status === "success" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-success-50 text-success-700 border border-success-100">
                            Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-danger-50 text-danger-700 border border-danger-100">
                            Failed
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[13px] text-ink-600 capitalize">{log.provider}</span>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-ink-500">
                        {new Date(log.created_at).toISOString().replace("T", " ").slice(0, 19) + "Z"}
                      </td>
                      <td className="px-6 py-4 text-[13px] text-ink-500">
                        {(log as any).processing_ms ? `${(log as any).processing_ms}ms` : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {log.status === "failed" ? (
                          <button className="text-[11px] font-bold text-brand-600 hover:underline flex items-center gap-1 justify-end ml-auto">
                            <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Retry
                          </button>
                        ) : (
                          <Link
                            href={`/webhooks/${log.id}`}
                            className="text-[11px] font-bold text-ink-400 group-hover:text-ink-600 transition-colors"
                          >
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-ink-100 flex items-center justify-between">
            <span className="text-xs text-ink-500 font-medium">
              Showing {offset + 1} to {Math.min(offset + perPage, count ?? 0)} of {(count ?? 0).toLocaleString()} events
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={page > 1 ? `/webhooks?page=${page - 1}${searchParams.status ? `&status=${searchParams.status}` : ""}` : "#"}
                className={`px-3 py-1.5 text-xs font-semibold border rounded-lg flex items-center gap-1 transition-colors ${
                  page <= 1
                    ? "text-ink-300 border-ink-100 cursor-not-allowed"
                    : "text-ink-600 border-ink-200 hover:bg-ink-50"
                }`}
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                Previous
              </Link>
              <Link
                href={page < totalPages ? `/webhooks?page=${page + 1}${searchParams.status ? `&status=${searchParams.status}` : ""}` : "#"}
                className={`px-3 py-1.5 text-xs font-semibold border rounded-lg flex items-center gap-1 transition-colors ${
                  page >= totalPages
                    ? "text-ink-300 border-ink-100 cursor-not-allowed"
                    : "text-ink-600 border-ink-200 hover:bg-ink-50"
                }`}
              >
                Next
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Help Banner */}
      <div className="bg-brand-50 border border-brand-100 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 pointer-events-none select-none flex items-center justify-end pr-4">
          <svg className="w-48 h-48 text-brand-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H8V3zm-2 2H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2V3a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v2z"/>
          </svg>
        </div>
        <div className="flex items-start gap-4 relative">
          <div className="bg-white p-3 rounded-lg shadow-sm border border-brand-100 flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <div>
            <h4 className="font-bold text-ink-900">Need help implementing verification?</h4>
            <p className="text-sm text-ink-600 max-w-lg mt-1">
              Read our security best practices for verifying webhook signatures to ensure events are coming from PayCraft Cloud.
            </p>
          </div>
        </div>
        <a
          href="#"
          className="whitespace-nowrap bg-white text-brand-600 px-4 py-2 rounded-lg text-sm font-bold border border-brand-100 hover:bg-white/80 transition-all shadow-sm relative"
        >
          View Documentation
        </a>
      </div>
    </div>
  )
}
