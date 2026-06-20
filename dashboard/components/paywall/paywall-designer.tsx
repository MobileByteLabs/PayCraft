"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Eye, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  PaywallConfig,
  PAYWALL_CONFIG_DEFAULTS,
  ValuePropTriple,
  VALUE_PROP_ICON_VOCAB,
  ValuePropIconKey,
} from "@/lib/types"
// PreviewIframe removed — preview is React-rendered inline

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
    name: "branded-stack",
    label: "Branded Stack",
    description: "Hero + value props + plan stack with MOST POPULAR ring (v2 default).",
  },
  {
    name: "minimal",
    label: "Minimal",
    description: "Deprecated — drops in cmp-paycraft 3.0.0. Kept for back-compat only.",
  },
  {
    name: "premium",
    label: "Premium",
    description: "Deprecated — drops in cmp-paycraft 3.0.0. Kept for back-compat only.",
  },
  {
    name: "dark",
    label: "Dark",
    description: "Deprecated — drops in cmp-paycraft 3.0.0. Kept for back-compat only.",
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
        {/* Content — v2 dashboard-driven copy */}
        <section className="bg-white p-5 rounded-xl border border-ink-200 shadow-sm">
          <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-4">
            Content
          </h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-600">Hero title</label>
              <input
                value={cfg.hero_title}
                onChange={(e) => setCfg({ ...cfg, hero_title: e.target.value })}
                placeholder="Upgrade to Premium"
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-600">Hero subtitle</label>
              <input
                value={cfg.hero_subtitle}
                onChange={(e) => setCfg({ ...cfg, hero_subtitle: e.target.value })}
                placeholder="Ad-free. Unlimited. 4K Downloads."
                className="input"
              />
            </div>

            {/* Value props repeater */}
            <ValuePropsRepeater
              value={cfg.value_props}
              onChange={(value_props) => setCfg({ ...cfg, value_props })}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink-600">CTA · Continue</label>
                <input
                  value={cfg.cta_continue}
                  onChange={(e) => setCfg({ ...cfg, cta_continue: e.target.value })}
                  placeholder="Continue"
                  className="input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink-600">CTA · Get Premium</label>
                <input
                  value={cfg.cta_get_premium}
                  onChange={(e) => setCfg({ ...cfg, cta_get_premium: e.target.value })}
                  placeholder="Get Premium"
                  className="input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-600">Restore label</label>
              <input
                value={cfg.restore_label}
                onChange={(e) => setCfg({ ...cfg, restore_label: e.target.value })}
                placeholder="Restore Your Premium"
                className="input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink-600">Terms URL</label>
                <input
                  value={cfg.terms_url ?? ""}
                  onChange={(e) => setCfg({ ...cfg, terms_url: e.target.value || null })}
                  placeholder="https://app.example.com/terms"
                  className="input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink-600">Privacy URL</label>
                <input
                  value={cfg.privacy_url ?? ""}
                  onChange={(e) => setCfg({ ...cfg, privacy_url: e.target.value || null })}
                  placeholder="https://app.example.com/privacy"
                  className="input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-600">Most popular plan</label>
              <select
                value={cfg.popular_plan_sku ?? ""}
                onChange={(e) => setCfg({ ...cfg, popular_plan_sku: e.target.value || null })}
                className="w-full bg-ink-50 border border-ink-200 rounded-lg text-sm font-medium text-ink-700 py-2 px-3 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              >
                <option value="">— No badge —</option>
                {products.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.display_name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-ink-600 font-medium select-none">
                Post-purchase celebration sheet
              </summary>
              <div className="space-y-3 mt-3 pl-2 border-l-2 border-ink-100">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink-600">Success title</label>
                  <input
                    value={cfg.success_title}
                    onChange={(e) => setCfg({ ...cfg, success_title: e.target.value })}
                    placeholder="Welcome to Premium!"
                    className="input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink-600">Success message</label>
                  <textarea
                    value={cfg.success_message}
                    onChange={(e) => setCfg({ ...cfg, success_message: e.target.value })}
                    placeholder="You now have access to all premium features."
                    rows={2}
                    className="input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink-600">Success CTA</label>
                  <input
                    value={cfg.success_cta_label}
                    onChange={(e) => setCfg({ ...cfg, success_cta_label: e.target.value })}
                    placeholder="Continue to app"
                    className="input"
                  />
                </div>
              </div>
            </details>

            <details className="text-sm">
              <summary className="cursor-pointer text-ink-600 font-medium select-none">
                Hero icon (SVG path or URL)
              </summary>
              <div className="space-y-3 mt-3 pl-2 border-l-2 border-ink-100">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink-600">Inline SVG</label>
                  <textarea
                    value={cfg.hero_icon_svg ?? ""}
                    onChange={(e) => setCfg({ ...cfg, hero_icon_svg: e.target.value || null })}
                    placeholder='<svg viewBox="0 0 24 24">...</svg>'
                    rows={3}
                    className="input font-mono text-xs"
                  />
                  <p className="text-[11px] text-ink-500">
                    Sanitized server-side. `&lt;script&gt;`, `&lt;foreignObject&gt;`, and external URL refs are rejected.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink-600">URL fallback (cmp-paycraft 2.2.0+)</label>
                  <input
                    value={cfg.hero_icon_url ?? ""}
                    onChange={(e) => setCfg({ ...cfg, hero_icon_url: e.target.value || null })}
                    placeholder="https://cdn.example.com/hero.png"
                    className="input"
                  />
                </div>
              </div>
            </details>
          </div>
        </section>

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

        {/* Preview Canvas — true-WYSIWYG iframe of actual cmp-paycraft Kotlin/JS bundle */}
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

          {/* Mobile Mockup — true-WYSIWYG React preview of the actual paywall */}
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

// ─── PaywallPreview — React-rendered phone mockup content ─────────────────

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
  const fontFamily =
    cfg.font_family && !cfg.font_family.includes("(default)")
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
            cfg={cfg}
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
            <span className="text-[10px] font-medium" style={{ color: fg }}>
              Powered by
            </span>
            <span
              className="text-[11px] font-black uppercase tracking-tighter"
              style={{ color: fg }}
            >
              PayCraft
            </span>
          </div>
        )}
        {branding === "custom" && cfg.custom_footer && (
          <div
            className="mt-auto pt-6 text-center text-[10px] opacity-40"
            style={{ color: fg }}
          >
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

// Icon map for value prop icons rendered in the preview
const VP_ICON_SVG: Record<string, string> = {
  "ad-free":
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z",
  unlimited:
    "M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.66 10.48 12h.01L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2C8.2 7.18 6.84 6.62 5.4 6.62 2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l2.83-2.5.01.01L13.52 12h-.01l2.69-2.39c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12c1.02 1.01 2.37 1.57 3.82 1.57C21.58 17.38 24 14.96 24 12s-2.42-5.38-5.4-5.38z",
  "4k-downloads":
    "M5 20h14v-2H5v2zm7-18L5.33 9h3.84v4h5.66V9h3.84L12 2z",
  offline:
    "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z",
  sync: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
  cloud:
    "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  check:
    "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
}

function VpIcon({ icon, primary }: { icon: string; primary: string }) {
  const d = VP_ICON_SVG[icon] ?? VP_ICON_SVG["check"]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-4 h-4 flex-shrink-0"
      style={{ color: primary }}
    >
      <path d={d} />
    </svg>
  )
}

function FreeState({
  cfg,
  isPremium,
  isDark,
  surface,
  surfaceBorder,
  primary,
  products,
}: {
  cfg: PaywallConfig
  isPremium: boolean
  isDark: boolean
  surface: string
  surfaceBorder: string
  primary: string
  products: Product[]
}) {
  const heroTitle = cfg.hero_title || "Upgrade to Premium"
  const heroSubtitle =
    cfg.hero_subtitle || "Ad-free. Unlimited. 4K Downloads."
  const ctaLabel = cfg.cta_continue || "Continue"

  const subs = products.filter(
    (p) => p.type === "subscription" || p.type === "lifetime",
  )
  const trial = products.find((p) => p.type === "trial")

  // Fallback sample if no products configured yet
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

  // Determine popular plan: prefer cfg.popular_plan_sku match, else default
  // to middle plan (idx 1) or first when ≤2 plans (old behaviour).
  const popularId = cfg.popular_plan_sku
    ? (fallback.find(
        (p) => p.sku === cfg.popular_plan_sku || p.id === cfg.popular_plan_sku,
      )?.id ?? null)
    : null

  function isPopular(p: Product, idx: number): boolean {
    if (popularId !== null) return p.id === popularId
    return idx === 1 || (fallback.length <= 2 && idx === 0)
  }

  const hasValueProps = cfg.value_props && cfg.value_props.length > 0

  // Build footer micro-links from cfg
  const footerLinks: string[] = []
  if (cfg.restore_label) footerLinks.push(cfg.restore_label.toUpperCase())
  if (cfg.terms_url) footerLinks.push("TERMS")
  if (cfg.privacy_url) footerLinks.push("PRIVACY")
  if (footerLinks.length === 0) {
    footerLinks.push("PRIVACY", "TERMS", "RESTORE")
  }

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
            {heroTitle}
          </h2>
          <p className="text-xs opacity-70 mt-1 font-medium">{heroSubtitle}</p>
        </>
      )}

      {/* Value props — rendered above plan stack when present */}
      {hasValueProps && (
        <div className="mt-4 space-y-1.5 text-left">
          {cfg.value_props.map((vp, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="mt-0.5">
                <VpIcon icon={vp.icon} primary={primary} />
              </div>
              <div>
                <div className="text-xs font-semibold leading-tight">{vp.title}</div>
                {vp.description && (
                  <div className="text-[11px] opacity-60 leading-tight mt-0.5">
                    {vp.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-2.5 text-left">
        {trial && (
          <div
            className="p-3 rounded-2xl text-left"
            style={{ background: surface, border: `2px dashed ${primary}` }}
          >
            <div
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: primary }}
            >
              Try free for {trial.trial_duration_days} days
            </div>
            <div className="text-xs opacity-60 mt-0.5">
              Then ${(fallback[0]?.base_price_cents ?? 0) / 100}/
              {fallback[0]?.interval ?? "month"}
            </div>
          </div>
        )}
        {fallback.map((p, idx) => {
          const popular = isPopular(p, idx)
          return (
            <div
              key={p.id}
              className="p-3 rounded-2xl flex items-center justify-between relative"
              style={{
                background: surface,
                border: `${popular ? "2" : "1"}px solid ${popular ? primary : surfaceBorder}`,
                ...(popular ? { backgroundColor: `${primary}08` } : {}),
              }}
            >
              {popular && (
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
                ${(p.base_price_cents / 100).toFixed(
                  p.base_price_cents % 100 === 0 ? 0 : 2,
                )}
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="w-full rounded-2xl py-3 text-white font-bold text-sm mt-1 shadow-lg"
          style={{ background: primary, boxShadow: `0 8px 24px -4px ${primary}55` }}
        >
          {ctaLabel}
        </button>
        <div className="flex items-center justify-center gap-3 text-[9px] font-bold opacity-40 uppercase tracking-widest mt-2">
          {footerLinks.map((link, i) => (
            <span key={i}>{link}</span>
          ))}
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

// ─── ValuePropsRepeater — add/remove/reorder rich-triple bullets ──────────

function ValuePropsRepeater({
  value,
  onChange,
}: {
  value: ValuePropTriple[]
  onChange: (next: ValuePropTriple[]) => void
}) {
  function add() {
    onChange([...value, { icon: "ad-free", title: "", description: "" }])
  }
  function update(idx: number, patch: Partial<ValuePropTriple>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }
  function move(idx: number, delta: -1 | 1) {
    const j = idx + delta
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink-600">
          Value props ({value.length})
        </label>
        <button
          type="button"
          onClick={add}
          className="text-[11px] font-bold text-brand-600 hover:text-brand-700"
        >
          + Add bullet
        </button>
      </div>
      {value.length === 0 && (
        <p className="text-[11px] text-ink-500 italic">
          No bullets yet — paywall renders without a value-prop list.
        </p>
      )}
      {value.map((v, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[88px_1fr_auto] gap-2 p-2 rounded-lg border border-ink-100 bg-ink-50/50"
        >
          <select
            value={v.icon}
            onChange={(e) => update(idx, { icon: e.target.value })}
            className="bg-white border border-ink-200 rounded text-[12px] py-1 px-2"
          >
            {VALUE_PROP_ICON_VOCAB.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div className="space-y-1">
            <input
              value={v.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="Ad-free experience"
              className="w-full bg-white border border-ink-200 rounded text-sm py-1 px-2"
            />
            <input
              value={v.description ?? ""}
              onChange={(e) => update(idx, { description: e.target.value || undefined })}
              placeholder="No interruptions across the entire app (optional)"
              className="w-full bg-white border border-ink-200 rounded text-xs py-1 px-2 text-ink-600"
            />
          </div>
          <div className="flex flex-col items-center gap-1 text-ink-400">
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              className="text-[10px] hover:text-ink-700 disabled:opacity-30"
              aria-label="Move up"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === value.length - 1}
              className="text-[10px] hover:text-ink-700 disabled:opacity-30"
              aria-label="Move down"
            >
              ▼
            </button>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-[10px] text-danger-600 hover:text-danger-700"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

