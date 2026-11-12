"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { addProvider, moveProvider, providersFromRule, removeProvider, toPriorityMethods } from "@/lib/platform-provider-order"

/**
 * Per-platform provider ranking (migration 075 routing engine).
 *
 * For each app platform the merchant ranks ANY NUMBER of providers — the first that can serve a buyer
 * is used, the rest are fallbacks in order. Saved per platform as a routing rule whose ordered
 * `priority_methods` holds the list (it was capped at `[primary, fallback]`). On the web there are no
 * store rules, so the buyer is shown every provider on this list that can charge their price, in order.
 *
 * iOS/Android digital subscriptions always transact through the native store (App Store / Google
 * Play) per store policy — shown as an automatic badge. The ranked list governs the
 * web-lane (physical goods / non-digital) on those platforms, and full checkout on Desktop/Web.
 */

interface RegistryRow {
  method: string
  provider: string
  fee_percent: number | null
}
interface RoutingRule {
  id: string
  platform: string | null
  priority_methods: string[]
  country_code?: string | null
  currency?: string | null
  product_type?: string | null
}

const DISPLAY: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  direct_upi: "UPI Direct",
  google_play: "Google Play Billing",
  app_store: "App Store (StoreKit 2)",
}

/** Every provider PayCraft supports — native store lanes + routable web providers. */
const CATALOG: {
  key: string
  lane: "native" | "web"
  on?: string
  href: string
  nativeFee?: string
}[] = [
  { key: "app_store", lane: "native", on: "iOS", href: "/providers/app-store", nativeFee: "15–30% store cut" },
  { key: "google_play", lane: "native", on: "Android", href: "/providers/google-play", nativeFee: "15–30% store cut" },
  { key: "stripe", lane: "web", href: "/providers/stripe" },
  { key: "razorpay", lane: "web", href: "/providers/razorpay" },
  { key: "cashfree", lane: "web", href: "/providers/cashfree" },
  { key: "direct_upi", lane: "web", href: "/providers/upi" },
]

const PLATFORMS: { key: string; label: string; nativeKey?: string; native?: string; nativeHref?: string }[] = [
  { key: "ios", label: "iOS", nativeKey: "app_store", native: "App Store (StoreKit 2)", nativeHref: "/providers/app-store" },
  { key: "android", label: "Android", nativeKey: "google_play", native: "Google Play Billing", nativeHref: "/providers/google-play" },
  { key: "desktop", label: "Desktop" },
  { key: "web", label: "Web" },
]
const isNativePlatform = (key: string) => key === "ios" || key === "android"


export function PlatformProvidersPanel({
  registry,
  connectedProviders,
  initialRules,
}: {
  registry: RegistryRow[]
  connectedProviders: string[]
  initialRules: RoutingRule[]
}) {
  const connected = new Set(connectedProviders)
  const WEB = new Set(["stripe", "razorpay", "cashfree", "direct_upi"])

  // provider → { cheapest method, fee } from the fee-sorted registry (includes native store methods)
  const providerInfo = new Map<string, { method: string; fee: number }>()
  for (const r of registry) {
    if (!providerInfo.has(r.provider)) providerInfo.set(r.provider, { method: r.method, fee: r.fee_percent ?? 99 })
  }
  const methodToProvider = new Map<string, string>()
  for (const r of registry) methodToProvider.set(r.method, r.provider)
  // connected WEB providers, cheapest first — the routable options for the web lane
  const webOptions = [...providerInfo.keys()]
    .filter((p) => WEB.has(p) && connected.has(p))
    .sort((a, b) => providerInfo.get(a)!.fee - providerInfo.get(b)!.fee)

  // Primary options per platform: native platforms lead with their native store, then web providers.
  const primaryOptions = (platform: string) => {
    const nk = PLATFORMS.find((p) => p.key === platform)?.nativeKey
    return nk ? [nk, ...webOptions] : webOptions
  }

  const fee = (p: string) => {
    if (!WEB.has(p)) return " · native"
    const f = providerInfo.get(p)?.fee
    return f != null && f < 99 ? ` · ${f}%` : ""
  }
  const pretty = (p: string) => DISPLAY[p] ?? p

  // load per-platform rankings from routing rules (priority_methods, any length, in order)
  const initSel: Record<string, string[]> = {}
  const ruleIdByPlatform: Record<string, string> = {}
  for (const rule of initialRules) {
    const plat = rule.platform
    if (!plat || plat === "any") continue
    if (rule.country_code || rule.currency || rule.product_type) continue
    ruleIdByPlatform[plat] = rule.id
    // native store methods are valid registry entries (migration 076), so they read back like any other
    initSel[plat] = providersFromRule(rule.priority_methods, methodToProvider)
  }
  const cheapestMethod = new Map([...providerInfo].map(([p, i]) => [p, i.method]))

  const [sel, setSel] = useState<Record<string, string[]>>(initSel)
  const [ruleIds, setRuleIds] = useState<Record<string, string>>(ruleIdByPlatform)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(platform: string, next: string[]) {
    setError(null)
    setSaving(platform)
    setSaved(null)
    setSel((s) => ({ ...s, [platform]: next }))
    try {
      const existing = ruleIds[platform]
      if (existing) {
        await fetch(`/api/routing-rules/${existing}`, { method: "DELETE" }).catch(() => {})
        setRuleIds((r) => {
          const c = { ...r }
          delete c[platform]
          return c
        })
      }
      // the ranked list → each provider's cheapest method, in order. A web provider needs a connected
      // account; a native store (app_store/google_play) is intrinsic to its platform.
      const methods = toPriorityMethods(next, cheapestMethod, connected, WEB)
      if (methods.length > 0) {
        const res = await fetch("/api/routing-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform, priority_methods: methods, country_code: null, currency: null, product_type: null, priority: 20 }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error ?? `save failed (${res.status})`)
        }
        const { id } = await res.json()
        if (id) setRuleIds((r) => ({ ...r, [platform]: id }))
      }
      setSaved(platform)
      setTimeout(() => setSaved((cur) => (cur === platform ? null : cur)), 2500)
    } catch (e: any) {
      setError(`${platform}: ${e?.message ?? "save failed"}`)
    } finally {
      setSaving(null)
    }
  }

  const noProviders = webOptions.length === 0

  // fee label for the catalog: web → registry %, native → store-cut range
  const catalogFee = (c: (typeof CATALOG)[number]) => {
    if (c.lane === "native") return c.nativeFee ?? ""
    const f = providerInfo.get(c.key)?.fee
    return f != null && f < 99 ? `${f}%` : "—"
  }

  return (
    <div className="space-y-4">
      {/* ── Supported providers catalog (all providers + connection status) ── */}
      <Card>
        <CardBody>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-ink-900">Supported providers</h2>
            <Badge>{CATALOG.filter((c) => connected.has(c.key)).length} connected</Badge>
          </div>
          <p className="text-xs text-ink-500 mb-4 max-w-2xl">
            Every provider PayCraft supports. Connect the ones you want, then rank them per platform below. Fees are the provider's domestic rate — lower routes cheaper.
          </p>
          <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
            <div className="hidden sm:grid grid-cols-[1fr_120px_140px_130px] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">
              <span>Provider</span>
              <span>Lane</span>
              <span>Fee</span>
              <span>Status</span>
            </div>
            {CATALOG.map((c) => {
              const isConnected = connected.has(c.key)
              return (
                <div key={c.key} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_130px] gap-1 sm:gap-3 px-4 py-3 sm:items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-900">{DISPLAY[c.key] ?? c.key}</span>
                  </div>
                  <div>
                    {c.lane === "native" ? (
                      <span className="text-[11px] font-medium text-ink-600">Native · {c.on}</span>
                    ) : (
                      <span className="text-[11px] font-medium text-ink-600">Web</span>
                    )}
                  </div>
                  <div className="text-[13px] tabular-nums text-ink-700">{catalogFee(c)}</div>
                  <div>
                    {isConnected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
                      </span>
                    ) : (
                      <Link href={c.href} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-ink-300" /> Connect →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-ink-400 mt-3">
            Native stores (App Store / Google Play) are mandatory for iOS &amp; Android digital
            subscriptions per store policy. Web providers route Desktop, Web, and the physical-goods
            lane.
          </p>
        </CardBody>
      </Card>

      {/* ── Per-platform provider ranking ── */}
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Platform providers</h2>
          <Badge>ranked · any number</Badge>
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          Rank as many providers as you like for each platform — the <strong>first</strong> that can
          serve a customer is used, the rest are fallbacks in order. On the <strong>web</strong> there
          are no store rules, so buyers see <strong>every</strong> provider on the list that can charge
          their price and choose how to pay. iOS &amp; Android lead with the native store (App Store /
          Google Play), the required lane for digital subscriptions. Saves instantly.
        </p>

        {noProviders ? (
          <p className="text-xs text-amber-600">
            Connect a payment provider (
            <Link href="/providers" className="font-semibold text-brand-600">Providers</Link>
            ) first — then rank them per platform.
          </p>
        ) : (
          <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
            <div className="hidden sm:grid grid-cols-[120px_1fr] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">
              <span>Platform</span>
              <span>Providers, in order</span>
            </div>
            {PLATFORMS.map((p) => {
              const native = isNativePlatform(p.key)
              // native platforms show their store first until the merchant ranks something else
              const list = sel[p.key] ?? (native && p.nativeKey ? [p.nativeKey] : [])
              const addable = primaryOptions(p.key).filter((o) => !list.includes(o))
              const busy = saving === p.key
              return (
                <div key={p.key} className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3 px-4 py-3">
                  <div className="flex items-start pt-2">
                    <span className="text-sm font-bold text-ink-900">{p.label}</span>
                  </div>
                  <div className="space-y-2" data-platform-list={p.key}>
                    {list.length === 0 && (
                      <p className="text-[12px] text-ink-400 py-2">Auto — the cheapest connected provider. Add providers to rank them.</p>
                    )}
                    <ol className="space-y-1.5">
                      {list.map((prov, idx) => (
                        <li key={prov} className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink-100 text-[11px] font-bold text-ink-600">{idx + 1}</span>
                          <span className="flex-1 text-sm text-ink-900">
                            {pretty(prov)}
                            <span className="text-ink-400">{fee(prov)}</span>
                            {idx === 0 && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">primary</span>}
                            {WEB.has(prov) && !connected.has(prov) && <span className="ml-2 text-[10px] font-semibold text-amber-600">not connected — skipped</span>}
                          </span>
                          <IconButton label={`Move ${pretty(prov)} up`} disabled={busy || idx === 0} onClick={() => save(p.key, moveProvider(list, idx, -1))}>↑</IconButton>
                          <IconButton label={`Move ${pretty(prov)} down`} disabled={busy || idx === list.length - 1} onClick={() => save(p.key, moveProvider(list, idx, 1))}>↓</IconButton>
                          <IconButton label={`Remove ${pretty(prov)}`} disabled={busy} onClick={() => save(p.key, removeProvider(list, idx))}>×</IconButton>
                        </li>
                      ))}
                    </ol>
                    <div className="flex items-center gap-2">
                      {addable.length > 0 && (
                        <ProviderSelect
                          label={`Add a provider for ${p.label}`}
                          value=""
                          placeholder="+ Add provider"
                          options={addable}
                          pretty={pretty}
                          fee={fee}
                          disabled={busy}
                          onChange={(v) => v && save(p.key, addProvider(list, v))}
                        />
                      )}
                      {busy && <span className="text-[11px] text-ink-400">saving…</span>}
                      {saved === p.key && <span className="text-[11px] font-semibold text-emerald-600">✓ saved</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-[11px] text-ink-400 mt-3">
          Fees are the provider's domestic rate — lower routes cheaper. Cross-border adds each
          provider's FX markup.
        </p>
      </CardBody>
    </Card>
    </div>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-sm text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function ProviderSelect({
  label,
  value,
  placeholder,
  options,
  pretty,
  fee,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  options: string[]
  pretty: (p: string) => string
  fee: (p: string) => string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {pretty(p)}{fee(p)}
        </option>
      ))}
    </select>
  )
}
