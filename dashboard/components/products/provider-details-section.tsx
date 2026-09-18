import { ChevronRight, ExternalLink } from "lucide-react"

/**
 * Everything a provider holds for ONE product, in one expandable place.
 *
 * The information existed but was scattered: the ids lived in columns nobody renders, the sync
 * verdict lived in `sync_state` which only surfaced as a coloured chip, and the per-currency plan
 * ids were invisible entirely. Debugging "why did this open Stripe instead of Razorpay?" therefore
 * meant querying the database — which is exactly what happened repeatedly.
 *
 * Native <details>/<summary>, so it expands with no client JavaScript and works inside a server
 * component. Collapsed by default: the summary row carries the state, and the detail is there when
 * a question needs it.
 */

type SyncEntry = { status?: string; error?: string; warning?: string; reason?: string }

export interface ProviderDetailsProps {
  product: {
    sku: string
    type: string
    stripe_product_id: string | null
    stripe_price_id_by_currency: Record<string, string> | null
    razorpay_plan_id_by_currency: Record<string, string> | null
    play_product_id: string | null
    app_store_product_id: string | null
    sync_state: Record<string, SyncEntry> | null
  }
  /** Provider → is it connected for this tenant (credential present, not merely a row). */
  connected: Record<string, boolean>
  /** Provider → is the row active. */
  active: Record<string, boolean>
  /**
   * Provider → the checkout links it issued for THIS product, plus which key mode they came from.
   * The mode is shown because a test link opens a checkout that cannot take money — indistinguishable
   * from a live one by looking at the URL.
   */
  paymentLinks?: Record<string, { mode: "live" | "test"; links: Record<string, string> }> | null
}

const LABEL: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  google_play: "Google Play",
  app_store: "App Store",
}

/** Per-provider ids for this product, in the shape each provider actually uses. */
function idsFor(p: ProviderDetailsProps["product"], provider: string): Array<[string, string]> {
  switch (provider) {
    case "stripe": {
      const out: Array<[string, string]> = []
      if (p.stripe_product_id) out.push(["product", p.stripe_product_id])
      for (const [ccy, id] of Object.entries(p.stripe_price_id_by_currency ?? {})) out.push([`price · ${ccy}`, id])
      return out
    }
    case "razorpay":
      // Subscriptions become Plans, not Payment Links — a plan id IS the synced artifact here.
      return Object.entries(p.razorpay_plan_id_by_currency ?? {}).map(([ccy, id]) => [`plan · ${ccy}`, id])
    case "google_play":
      return p.play_product_id ? [["product", p.play_product_id]] : []
    case "app_store":
      return p.app_store_product_id ? [["product", p.app_store_product_id]] : []
    default:
      return []
  }
}

function StateChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
        ok ? "bg-green-50 text-green-700 border-green-200" : "bg-ink-50 text-ink-500 border-ink-200"
      }`}
    >
      {label}
    </span>
  )
}

export function ProviderDetailsSection({ product, connected, active, paymentLinks }: ProviderDetailsProps) {
  const providers = ["stripe", "razorpay", "google_play", "app_store"]

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-bold text-ink-900">Providers</h3>
        <span className="text-[11px] text-ink-500">{product.sku}</span>
      </div>
      <p className="text-xs text-ink-500 mb-4">
        Connection state and every id this product holds at each provider. Expand a row for the
        per-currency artifacts and the last sync verdict.
      </p>

      <div className="divide-y divide-ink-100 border border-ink-100 rounded-lg overflow-hidden">
        {providers.map((prov) => {
          const ids = idsFor(product, prov)
          const s = product.sync_state?.[prov]
          const linkSet = paymentLinks?.[prov]
          const links = linkSet?.links ?? {}
          const isConnected = !!connected[prov]
          const isActive = !!active[prov]
          const status = s?.status ?? (ids.length ? "synced" : "not synced")
          const reason = s?.reason ?? s?.error ?? s?.warning ?? null

          return (
            <details key={prov} className="group bg-white open:bg-ink-50/40">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-ink-50">
                <ChevronRight className="w-3.5 h-3.5 text-ink-400 transition-transform group-open:rotate-90" />
                <span className="text-xs font-bold text-ink-900 w-28">{LABEL[prov] ?? prov}</span>
                <StateChip ok={isActive} label={isActive ? "active" : "inactive"} />
                <StateChip ok={isConnected} label={isConnected ? "connected" : "not connected"} />
                <span
                  className={`text-[11px] font-semibold ${
                    status === "synced" ? "text-green-700" : status === "failed" ? "text-red-600" : "text-ink-500"
                  }`}
                >
                  {status}
                </span>
                <span className="ml-auto text-[11px] text-ink-400">
                  {ids.length} id{ids.length === 1 ? "" : "s"}
                </span>
              </summary>

              <div className="px-4 pb-4 pt-1 space-y-3">
                {reason && (
                  // The reason is the whole point of showing a non-green state: "skipped" without
                  // "not connected for this tenant" sends the reader to the wrong fix.
                  <p className="text-[11px] text-ink-600 bg-ink-50 border border-ink-200 rounded px-2 py-1.5">
                    {reason}
                  </p>
                )}

                {ids.length === 0 ? (
                  <p className="text-[11px] text-ink-500">
                    No ids stored for this provider yet — it has not been synced for this product.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {ids.map(([label, id]) => (
                      <div key={label} className="flex items-center gap-2 text-[11px]">
                        <span className="text-ink-500 w-28 shrink-0">{label}</span>
                        <code className="font-mono text-ink-800 bg-ink-50 border border-ink-200 rounded px-1.5 py-0.5 break-all">
                          {id}
                        </code>
                        {prov === "stripe" && id.startsWith("prod_") && (
                          <a
                            href={`https://dashboard.stripe.com/products/${id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                          >
                            open <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {Object.keys(links).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-ink-700">
                      Checkout links{" "}
                      <span
                        className={`ml-1 px-1 py-0.5 rounded text-[9px] uppercase tracking-wide border ${
                          linkSet?.mode === "live"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {linkSet?.mode} mode
                      </span>
                    </p>
                    {Object.entries(links).map(([ccy, url]) => (
                      <div key={ccy} className="flex items-center gap-2 text-[11px]">
                        <span className="text-ink-500 w-28 shrink-0">{ccy}</span>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-600 hover:underline break-all"
                        >
                          {url} <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
