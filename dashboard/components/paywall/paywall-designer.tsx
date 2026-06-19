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
import { PreviewIframe } from "./PreviewIframe"

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

          {/* Iframe — renders the actual cmp-paycraft Kotlin/JS preview bundle.
              Zero drift between what the dashboard shows and what the SDK ships. */}
          <div className="w-[320px] z-10 transition-transform duration-500 hover:scale-[1.02]">
            <PreviewIframe config={cfg} state={previewState} />
          </div>
        </div>
      </div>
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

