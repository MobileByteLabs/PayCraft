import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { SubscriberTable } from "./subscriber-table"

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string; mode?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const page = parseInt(searchParams.page || "1")
  const perPage = 25
  const offset = (page - 1) * perPage
  const mode = searchParams.mode || "live"

  let query = supabase
    .from("subscriptions")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .eq("mode", mode)
    .order("updated_at", { ascending: false })
    .range(offset, offset + perPage - 1)

  if (searchParams.q) {
    query = query.ilike("email", `%${searchParams.q}%`)
  }
  if (searchParams.status) {
    query = query.eq("status", searchParams.status)
  }

  const { data: subscribers, count } = await query

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscribers</h1>
          <p className="text-sm text-gray-500 mt-1">
            {count ?? 0} total &middot; {tenant.plan} plan (limit: {tenant.subscriber_limit.toLocaleString()})
          </p>
        </div>
        <a
          href={`/api/subscribers/export?tenant_id=${tenant.id}&mode=${mode}`}
          className="px-4 py-2 text-sm font-medium text-brand-600 border border-brand-300 rounded-lg hover:bg-brand-50"
        >
          Export CSV
        </a>
      </div>
      <SubscriberTable
        subscribers={subscribers ?? []}
        totalCount={count ?? 0}
        page={page}
        perPage={perPage}
        currentMode={mode}
      />
    </div>
  )
}
