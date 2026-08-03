"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Per-platform primary + fallback provider selector (migration 075 routing engine).
 *
 * For each app platform the merchant picks a PRIMARY provider and an optional FALLBACK provider used
 * when the primary can't serve a customer. Saved per platform as a routing rule whose ordered
 * `priority_methods` is `[primary, fallback]`.
 *
 * iOS/Android digital subscriptions always transact through the native store (App Store / Google
 * Play) per store policy — shown as an automatic badge. The primary/fallback dropdowns govern the
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

type Sel = { primary: string; fallback: string }

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

  // load per-platform selections from routing rules (priority_methods = [primary, fallback])
  const initSel: Record<string, Sel> = {}
  const ruleIdByPlatform: Record<string, string> = {}
  for (const rule of initialRules) {
    const plat = rule.platform
    if (!plat || plat === "any") continue
    if (rule.country_code || rule.currency || rule.product_type) continue
    ruleIdByPlatform[plat] = rule.id
    // priority_methods = [primary, fallback] uniformly (native methods are valid registry entries)
    const primary = methodToProvider.get(rule.priority_methods?.[0] ?? "") ?? ""
    const fallback = methodToProvider.get(rule.priority_methods?.[1] ?? "") ?? ""
    initSel[plat] = { primary, fallback }
  }

  const [sel, setSel] = useState<Record<string, Sel>>(initSel)
  const [ruleIds, setRuleIds] = useState<Record<string, string>>(ruleIdByPlatform)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(platform: string, next: Sel) {
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
      // ordered [primary, fallback] → methods, uniform across platforms. A native store primary
      // (app_store/google_play) is a valid registry method (migration 076). Fallback must be a
      // connected web provider; the native primary is always available on its platform.
      const providers = [next.primary, next.fallback].filter((p, i, a) => {
        if (!p || a.indexOf(p) !== i) return false
        return WEB.has(p) ? connected.has(p) : true // web needs a connected account; native store is intrinsic
      })
      const methods = providers.map((p) => providerInfo.get(p)?.method).filter(Boolean) as string[]
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
            Every provider PayCraft supports. Connect the ones you want, then choose a primary +
            fallback per platform below. Fees are the provider's domestic rate — lower routes cheaper.
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

      {/* ── Per-platform primary + fallback routing ── */}
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Platform providers</h2>
          <Badge>primary + fallback</Badge>
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          Pick the <strong>primary</strong> provider and an optional <strong>fallback</strong> for
          each platform. iOS &amp; Android default to the native store (App Store / Google Play) —
          the required lane for digital subscriptions — but you can change it; the fallback web
          provider then serves physical goods / non-digital. Saves instantly.
        </p>

        {noProviders ? (
          <p className="text-xs text-amber-600">
            Connect a payment provider (
            <Link href="/providers" className="font-semibold text-brand-600">Providers</Link>
            ) first — then set a primary + fallback per platform.
          </p>
        ) : (
          <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
            {/* header */}
            <div className="hidden sm:grid grid-cols-[120px_1fr_1fr] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">
              <span>Platform</span>
              <span>Primary</span>
              <span>Fallback</span>
            </div>
            {PLATFORMS.map((p) => {
              const cur = sel[p.key] ?? { primary: "", fallback: "" }
              const native = isNativePlatform(p.key)
              // native platforms default-show their native store as primary until the merchant changes it
              const primaryValue = cur.primary || (native ? (p.nativeKey ?? "") : "")
              const primOpts = primaryOptions(p.key)
              return (
                <div key={p.key} className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr] gap-3 px-4 py-3 items-center">
                  <div className="flex items-center">
                    <span className="text-sm font-bold text-ink-900">{p.label}</span>
                  </div>

                  {/* Primary — a real dropdown on every platform; native store leads on iOS/Android */}
                  <ProviderSelect
                    label="Primary"
                    value={primaryValue}
                    placeholder={native ? "Choose primary" : "Auto — cheapest"}
                    options={primOpts}
                    pretty={pretty}
                    fee={fee}
                    disabled={saving === p.key}
                    onChange={(v) => save(p.key, { primary: v, fallback: cur.fallback === v ? "" : cur.fallback })}
                  />

                  {/* Fallback — a connected web provider (excludes the chosen primary) */}
                  <div className="flex items-center gap-2">
                    <ProviderSelect
                      label="Fallback"
                      value={cur.fallback}
                      placeholder="None"
                      options={webOptions.filter((o) => o !== primaryValue)}
                      pretty={pretty}
                      fee={fee}
                      disabled={saving === p.key}
                      onChange={(v) => save(p.key, { primary: primaryValue, fallback: v })}
                    />
                    {saving === p.key && <span className="text-[11px] text-ink-400">saving…</span>}
                    {saved === p.key && <span className="text-[11px] font-semibold text-emerald-600">✓ saved</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-[11px] text-ink-400 mt-3">
          Fees are the provider's domestic rate — lower routes cheaper. Cross-border adds each
          provider's FX markup. Fallback applies only after a primary is set.
        </p>
      </CardBody>
    </Card>
    </div>
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
