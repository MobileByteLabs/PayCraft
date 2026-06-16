"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Eye, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface PaywallConfig {
  tenant_id: string
  template: string
  theme_jsonb: Record<string, string>
  branding: "attribution" | "none" | "custom"
  custom_footer: string | null
  primary_color: string | null
  font_family: string | null
  support_email: string | null
}

interface Product {
  id: string
  sku: string
  type: "subscription" | "trial" | "lifetime"
  display_name: string
  interval: string | null
  base_price_cents: number
  base_currency: string
  display_order: number
  trial_duration_days: number | null
}

const TEMPLATES = [
  {
    name: "minimal",
    label: "Minimal",
    description: "Clean, focused, conversion-first layout.",
  },
  {
    name: "premium",
    label: "Premium",
    description: "High-impact imagery and feature grids.",
  },
  {
    name: "dark",
    label: "Dark",
    description: "Modern obsidian aesthetics for night mode.",
  },
]

type PreviewState =
  | "Loading"
  | "Free"
  | "Premium"
  | "Error"
  | "DeviceConflict"
  | "OwnershipVerified"

const STATES: PreviewState[] = [
  "Loading",
  "Free",
  "Premium",
  "Error",
  "DeviceConflict",
  "OwnershipVerified",
]

const FONT_OPTIONS = ["Inter (default)", "Public Sans", "Geist", "Outfit"]

export function PaywallDesigner({
  initial,
  products,
  canRemoveAttribution,
  plan,
}: {
  initial: PaywallConfig
  products: Product[]
  canRemoveAttribution: boolean
  plan: string
}) {
  const router = useRouter()
  const [cfg, setCfg] = useState<PaywallConfig>(initial)
  const [previewState, setPreviewState] = useState<PreviewState>("Free")
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    const res = await fetch("/api/paywall", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    })
    setSaving(false)
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString())
      router.refresh()
    }
  }

  function reset() {
    setCfg(initial)
    setSavedAt(null)
  }

  return (
    <div className="flex gap-8 overflow-hidden animate-fade-in" style={{ height: "calc(100vh - 13rem)" }}>
      {/* Left column: Controls */}
      <div className="w-[420px] flex-shrink-0 flex flex-col gap-6 overflow-y-auto pb-12" style={{ scrollbarWidth: "none" }}>
        {/* Template */}
        <section className="bg-white p-5 rounded-xl border border-ink-200 shadow-sm">
          <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-4">
            Template
          </h3>
          <div className="space-y-3">
            {TEMPLATES.map((t) => {
              const active = cfg.template === t.name
              return (
                <label
                  key={t.name}
                  className={`relative flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    active
                      ? "border-brand-600 bg-brand-50/30"
                      : "border-ink-200 bg-white hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    checked={active}
                    onChange={() => setCfg({ ...cfg, template: t.name })}
                    className="hidden"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-bold ${active ? "text-ink-900" : "text-ink-700"}`}
                      >
                        {t.label}
                      </span>
                      <span
                        className={`w-4 h-4 rounded-full flex-shrink-0 transition-all ${
                          active
                            ? "border-[4px] border-brand-600 bg-white"
                            : "border border-ink-300 bg-white"
                        }`}
                      />
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">{t.description}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </section>

        {/* Theme */}
        <section className="bg-white p-5 rounded-xl border border-ink-200 shadow-sm">
          <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-4">
            Theme
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-600">Primary color</span>
              <div className="flex items-center gap-2 p-1.5 border border-ink-200 rounded-lg bg-ink-50">
                <input
                  type="color"
                  value={cfg.primary_color ?? "#7C3AED"}
                  onChange={(e) => setCfg({ ...cfg, primary_color: e.target.value })}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  style={{ appearance: "none" }}
                />
                <span className="text-[13px] font-mono font-medium text-ink-700">
                  {(cfg.primary_color ?? "#7C3AED").toUpperCase()}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-600">Font family</label>
              <select
                value={cfg.font_family ?? "Inter (default)"}
                onChange={(e) => setCfg({ ...cfg, font_family: e.target.value })}
                className="w-full bg-ink-50 border border-ink-200 rounded-lg text-sm font-medium text-ink-700 py-2 px-3 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Branding */}
        <section className="bg-white p-5 rounded-xl border border-ink-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest">
              Branding
            </h3>
            <Badge
              tone={canRemoveAttribution ? "success" : "neutral"}
            >
              {plan}
            </Badge>
          </div>
          <div className="space-y-1">
            {[
              {
                value: "attribution" as const,
                label: "Powered by PayCraft by MobileByteSensei",
                badge: null,
                disabled: false,
              },
              {
                value: "none" as const,
                label: "No footer",
                badge: <span className="text-[9px] font-bold text-brand-700 bg-brand-100 px-1 rounded ml-1">PRO</span>,
                disabled: !canRemoveAttribution,
              },
              {
                value: "custom" as const,
                label: "Custom footer",
                badge: <span className="text-[9px] font-bold text-warning-700 bg-warning-100 px-1 rounded ml-1">ENTERPRISE</span>,
                disabled: !canRemoveAttribution,
              },
            ].map((b) => {
              const active = cfg.branding === b.value
              return (
                <label
                  key={b.value}
                  className={`flex items-center gap-3 p-2 rounded hover:bg-ink-50 cursor-pointer transition-colors ${
                    b.disabled ? "opacity-75" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="branding"
                    checked={active}
                    onChange={() => !b.disabled && setCfg({ ...cfg, branding: b.value })}
                    disabled={b.disabled}
                    className="accent-brand-600"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-ink-600">{b.label}</span>
                    {b.badge}
                  </div>
                </label>
              )
            })}
          </div>
          {cfg.branding === "custom" && canRemoveAttribution && (
            <input
              value={cfg.custom_footer ?? ""}
              onChange={(e) => setCfg({ ...cfg, custom_footer: e.target.value })}
              placeholder="Custom footer text"
              className="input mt-3"
            />
          )}
        </section>

        {/* Support email */}
        <section className="bg-white p-5 rounded-xl border border-ink-200 shadow-sm">
          <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-4">
            Support Contact
          </h3>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink-600">Support email</label>
            <input
              type="email"
              value={cfg.support_email ?? ""}
              onChange={(e) => setCfg({ ...cfg, support_email: e.target.value })}
              placeholder="support@yourapp.com"
              className="input"
            />
          </div>
        </section>

        {/* Save / Reset */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={reset}
            variant="secondary"
            leading={<RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />}
          >
            Reset
          </Button>
          <Button
            type="button"
            onClick={save}
            loading={saving}
            className="flex-1 justify-center"
          >
            Save paywall
          </Button>
        </div>
        {savedAt && (
          <div className="text-xs text-success-700 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            Saved at <span className="tabular-nums">{savedAt}</span> — SDK will
            pick this up on its next config fetch (max 1h).
          </div>
        )}
      </div>

      {/* Right column: Live Preview */}
      <div className="flex-1 flex flex-col gap-6 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-bold text-ink-400 uppercase tracking-widest">
              Preview · {previewState} State
            </span>
          </div>
          <div className="flex bg-white border border-ink-200 rounded-lg p-1 shadow-sm">
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPreviewState(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  previewState === s
                    ? "font-bold text-brand-600 bg-brand-50"
                    : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {s === "DeviceConflict" ? "Conflict" : s === "OwnershipVerified" ? "Verified" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Preview Canvas */}
        <div className="flex-1 bg-ink-200/50 rounded-3xl border-4 border-dashed border-ink-300 flex items-center justify-center relative overflow-hidden">
          {/* Dot-grid background */}
          <div className="absolute inset-0 opacity-40 pointer-events-none">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="preview-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <circle cx="20" cy="20" r="1" fill={cfg.primary_color ?? "#7C3AED"} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#preview-grid)" />
            </svg>
          </div>

          {/* SDK Sync tag */}
          <div className="absolute right-8 top-8 bg-white p-3 rounded-xl shadow-xl border border-ink-100 z-20">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-emerald-500" strokeWidth={2} />
              <span className="text-xs font-bold text-ink-700">SDK Sync Active</span>
            </div>
          </div>

          {/* Mobile Mockup */}
          <div
            className="w-[300px] h-[600px] bg-white rounded-[44px] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.2)] border-[10px] border-ink-900 relative flex flex-col overflow-hidden z-10 transition-transform duration-500 hover:scale-[1.02]"
          >
            {/* Phone notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 bg-ink-900 rounded-b-2xl z-20" />
            {/* Content scroll area */}
            <div className="flex-1 overflow-y-auto pt-10 pb-6 flex flex-col" style={{ scrollbarWidth: "none" }}>
              <PaywallPreview
                cfg={cfg}
                state={previewState}
                plan={plan}
                products={products}
              />
            </div>
            {/* Home indicator */}
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-28 h-1.5 bg-ink-200 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

function PaywallPreview({
  cfg,
  state,
  plan,
  products,
}: {
  cfg: PaywallConfig
  state: PreviewState
  plan: string
  products: Product[]
}) {
  const isDark = cfg.template === "dark"
  const isPremium = cfg.template === "premium"
  const bg = isDark ? "#121212" : "#FAFAFA"
  const fg = isDark ? "#FFFFFF" : "#18181B"
  const surface = isDark ? "#1E1E1E" : "#FFFFFF"
  const surfaceBorder = isDark ? "#333" : "#E4E4E7"
  const primary = cfg.primary_color ?? "#7C3AED"
  const fontFamily = cfg.font_family && !cfg.font_family.includes("(default)")
    ? `${cfg.font_family}, system-ui, sans-serif`
    : "Inter, system-ui, sans-serif"

  // Free tier always forces attribution regardless of branding setting.
  const branding =
    plan === "free"
      ? "attribution"
      : (cfg.branding as "attribution" | "none" | "custom")

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ background: bg, color: fg, fontFamily }}
    >
      <div className="px-6 pb-6 pt-2 flex flex-col flex-1 text-center">
        {state === "Loading" && <LoadingState fg={fg} primary={primary} />}
        {state === "Free" && (
          <FreeState
            isPremium={isPremium}
            isDark={isDark}
            surface={surface}
            surfaceBorder={surfaceBorder}
            primary={primary}
            products={products}
          />
        )}
        {state === "Premium" && (
          <PremiumState
            isPremium={isPremium}
            surface={surface}
            surfaceBorder={surfaceBorder}
            primary={primary}
          />
        )}
        {state === "Error" && (
          <ErrorState surface={surface} surfaceBorder={surfaceBorder} />
        )}
        {state === "DeviceConflict" && (
          <DeviceConflictState
            surface={surface}
            surfaceBorder={surfaceBorder}
            primary={primary}
          />
        )}
        {state === "OwnershipVerified" && (
          <OwnershipVerifiedState
            surface={surface}
            surfaceBorder={surfaceBorder}
            primary={primary}
          />
        )}

        {/* Branding footer */}
        {branding === "attribution" && (
          <div className="mt-auto pt-6 flex items-center justify-center gap-1.5 opacity-40">
            <span className="text-[10px] font-medium" style={{ color: fg }}>Powered by</span>
            <span className="text-[11px] font-black uppercase tracking-tighter" style={{ color: fg }}>PayCraft</span>
          </div>
        )}
        {branding === "custom" && cfg.custom_footer && (
          <div className="mt-auto pt-6 text-center text-[10px] opacity-40" style={{ color: fg }}>
            {cfg.custom_footer}
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingState({ fg, primary }: { fg: string; primary: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-4">
      <div
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: primary, borderTopColor: "transparent" }}
      />
      <p className="text-sm opacity-70" style={{ color: fg }}>
        Loading subscription status…
      </p>
    </div>
  )
}

function FreeState({
  isPremium,
  isDark,
  surface,
  surfaceBorder,
  primary,
  products,
}: {
  isPremium: boolean
  isDark: boolean
  surface: string
  surfaceBorder: string
  primary: string
  products: Product[]
}) {
  const subs = products.filter(
    (p) => p.type === "subscription" || p.type === "lifetime",
  )
  const trial = products.find((p) => p.type === "trial")

  // Fallback sample if no products
  const fallback: Product[] =
    subs.length === 0
      ? [
          {
            id: "1",
            sku: "monthly",
            type: "subscription",
            display_name: "Monthly",
            interval: "month",
            base_price_cents: 199,
            base_currency: "USD",
            display_order: 0,
            trial_duration_days: null,
          },
          {
            id: "2",
            sku: "yearly",
            type: "subscription",
            display_name: "Yearly",
            interval: "year",
            base_price_cents: 1999,
            base_currency: "USD",
            display_order: 1,
            trial_duration_days: null,
          },
          {
            id: "3",
            sku: "lifetime",
            type: "lifetime",
            display_name: "Lifetime",
            interval: null,
            base_price_cents: 4999,
            base_currency: "USD",
            display_order: 2,
            trial_duration_days: null,
          },
        ]
      : subs

  return (
    <div className="text-center flex flex-col">
      {/* Icon */}
      <div className="mt-6 mb-4 flex justify-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-xl"
          style={{ background: `linear-gradient(135deg, ${primary}, #A855F7)` }}
        >
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
          </svg>
        </div>
      </div>

      {isPremium ? (
        <div
          className="-mx-6 mb-4 py-6 px-6 text-white text-center"
          style={{ background: `linear-gradient(135deg, ${primary}, #4C1D95)` }}
        >
          <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80 mb-1">
            Premium
          </div>
          <h2 className="text-xl font-extrabold">Upgrade now</h2>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-extrabold tracking-tight leading-tight">
            Upgrade to Premium
          </h2>
          <p className="text-xs opacity-70 mt-1 font-medium">
            Ad-free. Unlimited. 4K Downloads.
          </p>
        </>
      )}

      <div className="mt-5 space-y-2.5 text-left">
        {trial && (
          <div
            className="p-3 rounded-2xl text-left"
            style={{ background: surface, border: `2px dashed ${primary}` }}
          >
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: primary }}>
              Try free for {trial.trial_duration_days} days
            </div>
            <div className="text-xs opacity-60 mt-0.5">
              Then ${(fallback[0]?.base_price_cents ?? 0) / 100}/
              {fallback[0]?.interval ?? "month"}
            </div>
          </div>
        )}
        {fallback.map((p, idx) => {
          const isPopular = idx === 1 || (fallback.length <= 2 && idx === 0)
          return (
            <div
              key={p.id}
              className="p-3 rounded-2xl flex items-center justify-between relative"
              style={{
                background: surface,
                border: `${isPopular ? "2" : "1"}px solid ${isPopular ? primary : surfaceBorder}`,
                ...(isPopular ? { backgroundColor: `${primary}08` } : {}),
              }}
            >
              {isPopular && (
                <span
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-white text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-tight shadow"
                  style={{ backgroundColor: primary }}
                >
                  Most popular
                </span>
              )}
              <div>
                <div className="text-xs font-bold">{p.display_name}</div>
                <div className="text-[11px] opacity-50 mt-0.5">
                  {p.type === "lifetime"
                    ? "Pay once, keep forever"
                    : `Billed every ${p.interval}`}
                </div>
              </div>
              <div className="text-xs font-extrabold tabular-nums">
                ${(p.base_price_cents / 100).toFixed(p.base_price_cents % 100 === 0 ? 0 : 2)}
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="w-full rounded-2xl py-3 text-white font-bold text-sm mt-1 shadow-lg"
          style={{ background: primary, boxShadow: `0 8px 24px -4px ${primary}55` }}
        >
          Continue
        </button>
        <div className="flex items-center justify-center gap-3 text-[9px] font-bold opacity-40 uppercase tracking-widest mt-2">
          <span>Privacy</span>
          <span>Terms</span>
          <span>Restore</span>
        </div>
      </div>
    </div>
  )
}

function PremiumState({
  isPremium,
  surface,
  surfaceBorder,
  primary,
}: {
  isPremium: boolean
  surface: string
  surfaceBorder: string
  primary: string
}) {
  return (
    <div>
      <div
        className="rounded-xl p-4 mb-4 flex items-center gap-3"
        style={{
          background: `${primary}11`,
          border: `1px solid ${primary}33`,
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: primary }}
        >
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">You're Premium</div>
          <div className="text-xs opacity-70">Renews Jul 5, 2026</div>
        </div>
      </div>
      <div
        className="rounded-xl p-4"
        style={{ background: surface, border: `1px solid ${surfaceBorder}` }}
      >
        <div className="text-xs font-bold uppercase tracking-wider opacity-50 mb-2">
          Current plan
        </div>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Monthly Premium</div>
          <div className="text-sm tabular-nums">$1.99/mo</div>
        </div>
      </div>
      <button
        type="button"
        className="w-full mt-4 rounded-xl py-2.5 text-sm font-medium border"
        style={{ borderColor: surfaceBorder }}
      >
        Manage subscription
      </button>
    </div>
  )
}

function ErrorState({
  surface,
  surfaceBorder,
}: {
  surface: string
  surfaceBorder: string
}) {
  return (
    <div>
      <div
        className="rounded-xl p-4 mb-4"
        style={{
          background: "#FEF2F2",
          border: "1px solid #FECACA",
          color: "#B91C1C",
        }}
      >
        <div className="text-sm font-semibold">Something went wrong</div>
        <div className="text-xs mt-1 opacity-80">
          We couldn't load your subscription. Check your network and retry.
        </div>
      </div>
      <button
        type="button"
        className="w-full rounded-xl py-2.5 text-sm font-medium border"
        style={{ borderColor: surfaceBorder, background: surface }}
      >
        Retry
      </button>
    </div>
  )
}

function DeviceConflictState({
  surface,
  surfaceBorder,
  primary,
}: {
  surface: string
  surfaceBorder: string
  primary: string
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">
        This subscription is on another device
      </h2>
      <p className="text-xs opacity-70 mt-1">
        Verify it's yours to transfer access here.
      </p>
      <div
        className="rounded-xl p-3 mt-4 space-y-1.5 text-xs"
        style={{ background: surface, border: `1px solid ${surfaceBorder}` }}
      >
        <div className="flex justify-between">
          <span className="opacity-50">Device</span>
          <span className="font-mono">iPhone 15 Pro</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-50">Last seen</span>
          <span className="tabular-nums">Jun 4, 2026 · 09:14</span>
        </div>
      </div>
      <div className="space-y-2 mt-4">
        <button
          type="button"
          className="w-full rounded-xl py-2.5 text-white text-sm font-semibold"
          style={{ background: primary }}
        >
          Verify via Google / Apple
        </button>
        <button
          type="button"
          className="w-full rounded-xl py-2.5 text-sm font-medium border"
          style={{ borderColor: surfaceBorder }}
        >
          Get a code by email (OTP)
        </button>
      </div>
    </div>
  )
}

function OwnershipVerifiedState({
  surface,
  surfaceBorder,
  primary,
}: {
  surface: string
  surfaceBorder: string
  primary: string
}) {
  return (
    <div>
      <div className="flex justify-center mb-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: `${primary}22`, color: primary }}
        >
          <Check className="w-5 h-5" strokeWidth={3} />
        </div>
      </div>
      <h2 className="text-base font-semibold text-center">
        Identity verified
      </h2>
      <p className="text-xs opacity-70 text-center mt-1">
        Transferring your Premium access to this device.
      </p>
      <div
        className="rounded-xl p-3 mt-4 text-xs"
        style={{ background: surface, border: `1px solid ${surfaceBorder}` }}
      >
        <div className="flex justify-between">
          <span className="opacity-50">Old device</span>
          <span>Disabled at completion</span>
        </div>
      </div>
      <button
        type="button"
        className="w-full mt-4 rounded-xl py-2.5 text-white text-sm font-semibold"
        style={{ background: primary }}
      >
        Confirm transfer
      </button>
    </div>
  )
}
