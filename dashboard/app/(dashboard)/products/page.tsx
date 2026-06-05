import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export default async function ProductsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data: products } = await supabase.rpc("tenant_products_list", {
    p_tenant_id: tenant.id,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">
            Subscription, Trial, and Lifetime offers fetched by the SDK from{" "}
            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
              /functions/v1/config
            </code>
          </p>
        </div>
        <Link
          href="/products/new"
          className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700"
        >
          + New product
        </Link>
      </div>

      {products && products.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  SKU
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  Display name
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  Base price
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  Order
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">
                    {p.sku}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/products/${p.id}`}
                      className="text-sm font-medium text-brand-600 hover:underline"
                    >
                      {p.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                      {p.type}
                      {p.type === "trial" && p.trial_duration_days
                        ? ` · ${p.trial_duration_days}d`
                        : null}
                      {p.type === "subscription" && p.interval
                        ? ` · ${p.interval}`
                        : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {p.type === "trial"
                      ? "—"
                      : `${(p.base_price_cents / 100).toFixed(2)} ${p.base_currency}`}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {p.display_order}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {p.active ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center">
          <p className="text-gray-500">No products yet.</p>
          <Link
            href="/products/new"
            className="mt-3 inline-block text-brand-600 hover:underline text-sm"
          >
            Create your first product →
          </Link>
        </div>
      )}
    </div>
  )
}
