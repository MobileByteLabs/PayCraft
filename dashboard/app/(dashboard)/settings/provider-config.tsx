"use client"

import type { TenantProvider } from "@/lib/types"

export function ProviderConfig({
  providers,
  tenantId,
}: {
  providers: TenantProvider[]
  tenantId: string
}) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Providers</h2>

      {providers.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">No providers configured yet.</p>
          <p className="text-sm text-gray-400">
            Use <code className="bg-gray-100 px-1 rounded">PayCraft.configure &#123;&#125;</code> in your app
            to set up payment links, or configure them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <div key={p.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold capitalize">{p.provider}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                  }`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              {/* Payment Links */}
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Test Payment Links</p>
                  {Object.keys(p.test_payment_links).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.entries(p.test_payment_links).map(([plan, url]) => (
                        <li key={plan} className="text-xs">
                          <span className="font-medium">{plan}:</span>{" "}
                          <span className="text-gray-500 truncate">{String(url).slice(0, 40)}...</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-400">None configured</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Live Payment Links</p>
                  {Object.keys(p.live_payment_links).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.entries(p.live_payment_links).map(([plan, url]) => (
                        <li key={plan} className="text-xs">
                          <span className="font-medium">{plan}:</span>{" "}
                          <span className="text-gray-500 truncate">{String(url).slice(0, 40)}...</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-400">None configured</p>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs text-gray-400">
                Secret keys are encrypted at rest. Last updated: {new Date(p.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
