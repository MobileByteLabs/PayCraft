import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { notFound } from "next/navigation"
import Link from "next/link"

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
    .order("registered_at", { ascending: false })

  return (
    <div>
      <Link href="/subscribers" className="text-sm text-brand-600 hover:text-brand-500">
        &larr; Back to subscribers
      </Link>

      <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900">{sub.email}</h1>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Detail label="Plan" value={sub.plan} />
          <Detail label="Status" value={sub.status} />
          <Detail label="Provider" value={sub.provider} />
          <Detail label="Mode" value={sub.mode} />
          <Detail label="Period End" value={sub.current_period_end ? new Date(sub.current_period_end).toLocaleString() : "—"} />
          <Detail label="Cancel at Period End" value={sub.cancel_at_period_end ? "Yes" : "No"} />
          <Detail label="Subscription ID" value={sub.provider_subscription_id || "—"} />
          <Detail label="Customer ID" value={sub.provider_customer_id || "—"} />
        </div>
      </div>

      {/* Devices */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Registered Devices</h2>
        {(!devices || devices.length === 0) ? (
          <p className="mt-3 text-sm text-gray-500">No devices registered</p>
        ) : (
          <table className="mt-3 min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Device</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Platform</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {devices.map((d: any) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-sm">{d.device_name || "Unknown"}</td>
                  <td className="px-4 py-3 text-sm">{d.platform}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {d.is_active ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(d.registered_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 mt-1">{value}</dd>
    </div>
  )
}
