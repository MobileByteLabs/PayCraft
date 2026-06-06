"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Crown, Eye, Layout, Palette, RotateCcw } from "lucide-react"
import { Card, CardBody } from "@/components/ui/card"
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
    description: "Clean, no-frills paywall. Best for productivity apps.",
    swatchClass: "bg-white",
  },
  {
    name: "premium",
    label: "Premium",
    description: "Polished gradient header + structured benefits.",
    swatchClass: "bg-gradient-to-br from-brand-100 to-brand-300",
  },
  {
    name: "dark",
    label: "Dark",
    description: "Dark-mode-first paywall. Best for media + entertainment.",
    swatchClass: "bg-ink-900",
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

const FONT_OPTIONS = ["Inter", "Roboto", "SF Pro", "System default"]

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
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 animate-fade-in">
      {/* Controls */}
      <div className="space-y-4">
        {/* Template */}
        <Card>
          <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
            <Layout className="w-4 h-4 text-ink-500" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-ink-900">Template</h3>
          </div>
          <CardBody className="space-y-2">
            {TEMPLATES.map((t) => {
              const active = cfg.template === t.name
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setCfg({ ...cfg, template: t.name })}
                  className={`w-full text-left flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    active
                      ? "border-brand-600 ring-2 ring-brand-100 bg-brand-50/30"
                      : "border-ink-200 hover:bg-ink-50"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-md border border-ink-200 flex-shrink-0 ${t.swatchClass}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-900 text-sm">
                      {t.label}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5 leading-snug">
                      {t.description}
                    </div>
                  </div>
                  {active && (
                    <Check
                      className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5"
                      strokeWidth={2.5}
                    />
                  )}
                </button>
              )
            })}
          </CardBody>
        </Card>

        {/* Theme */}
        <Card>
          <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
            <Palette className="w-4 h-4 text-ink-500" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-ink-900">Theme</h3>
          </div>
          <CardBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-700">
                Primary color
              </label>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="color"
                  value={cfg.primary_color ?? "#7C3AED"}
                  onChange={(e) =>
                    setCfg({ ...cfg, primary_color: e.target.value })
                  }
                  className="h-9 w-12 rounded-lg border border-ink-200 cursor-pointer"
                />
                <input
                  value={cfg.primary_color ?? "#7C3AED"}
                  onChange={(e) =>
                    setCfg({ ...cfg, primary_color: e.target.value })
                  }
                  className="input font-mono text-xs w-32"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700">
                Font family
              </label>
              <select
                value={cfg.font_family ?? "Inter"}
                onChange={(e) =>
                  setCfg({ ...cfg, font_family: e.target.value })
                }
                className="input mt-1.5"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </CardBody>
        </Card>

        {/* Branding */}
        <Card>
          <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
            <Crown className="w-4 h-4 text-ink-500" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-ink-900">Branding</h3>
            <Badge
              tone={canRemoveAttribution ? "success" : "neutral"}
              className="ml-auto"
            >
              {plan}
            </Badge>
          </div>
          <CardBody className="space-y-2">
            {[
              {
                value: "attribution" as const,
                label: "Powered by PayCraft by MobileByteSensei",
                desc: "Free tier default",
                disabled: false,
              },
              {
                value: "none" as const,
                label: "No footer",
                desc: canRemoveAttribution
                  ? "Pro+ tier"
                  : "Upgrade to Pro to enable",
                disabled: !canRemoveAttribution,
              },
              {
                value: "custom" as const,
                label: "Custom footer",
                desc: canRemoveAttribution
                  ? "Enterprise tier"
                  : "Upgrade to Pro to enable",
                disabled: !canRemoveAttribution,
              },
            ].map((b) => {
              const active = cfg.branding === b.value
              return (
                <label
                  key={b.value}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    b.disabled
                      ? "opacity-50 cursor-not-allowed border-ink-200"
                      : active
                      ? "border-brand-600 ring-2 ring-brand-100 cursor-pointer"
                      : "border-ink-200 hover:bg-ink-50 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="branding"
                    checked={active}
                    onChange={() =>
                      !b.disabled && setCfg({ ...cfg, branding: b.value })
                    }
                    disabled={b.disabled}
                    className="mt-0.5 accent-brand-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900">
                      {b.label}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">{b.desc}</div>
                  </div>
                </label>
              )
            })}
            {cfg.branding === "custom" && canRemoveAttribution && (
              <input
                value={cfg.custom_footer ?? ""}
                onChange={(e) =>
                  setCfg({ ...cfg, custom_footer: e.target.value })
                }
                placeholder="Custom footer text"
                className="input mt-1"
              />
            )}
          </CardBody>
        </Card>

        {/* Support email */}
        <Card>
          <CardBody>
            <label className="text-xs font-medium text-ink-700">
              Support email
            </label>
            <input
              type="email"
              value={cfg.support_email ?? ""}
              onChange={(e) =>
                setCfg({ ...cfg, support_email: e.target.value })
              }
              placeholder="support@yourapp.com"
              className="input mt-1.5"
            />
          </CardBody>
        </Card>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={save}
            loading={saving}
            className="flex-1 justify-center"
          >
            Save paywall
          </Button>
          <Button
            type="button"
            onClick={reset}
            variant="secondary"
            leading={<RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />}
          >
            Reset
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

      {/* Preview pane */}
      <div className="lg:sticky lg:top-32">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-ink-500" />
            <span className="text-2xs uppercase font-bold tracking-widest text-ink-500">
              Preview · {previewState} state
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 mb-4 text-xs">
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPreviewState(s)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                previewState === s
                  ? "bg-ink-900 text-white"
                  : "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <PaywallPreview
          cfg={cfg}
          state={previewState}
          plan={plan}
          products={products}
        />
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
  const fg = isDark ? "#FFFFFF" : "#0F172A"
  const surface = isDark ? "#1E1E1E" : "#FFFFFF"
  const surfaceBorder = isDark ? "#333" : "#E4E4E7"
  const primary = cfg.primary_color ?? "#7C3AED"
  const fontFamily = cfg.font_family
    ? `${cfg.font_family}, system-ui, sans-serif`
    : "Inter, system-ui, sans-serif"

  // Free tier always forces attribution regardless of branding setting.
  const branding =
    plan === "free"
      ? "attribution"
      : (cfg.branding as "attribution" | "none" | "custom")

  return (
    <div
      className="rounded-2xl overflow-hidden border border-ink-200 shadow-lg max-w-md mx-auto"
      style={{ background: bg, color: fg, fontFamily }}
    >
      {/* Phone-style top */}
      <div className="px-5 py-2 flex items-center justify-between text-2xs opacity-50 tabular-nums">
        <span>9:41</span>
        <span>100%</span>
      </div>

      <div className="px-6 pb-8 pt-4">
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
          <div className="mt-6 text-center text-2xs opacity-50">
            Powered by PayCraft by MobileByteSensei
          </div>
        )}
        {branding === "custom" && cfg.custom_footer && (
          <div className="mt-6 text-center text-2xs opacity-50">
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
        ]
      : subs

  return (
    <div className="text-center">
      {isPremium && (
        <div
          className="-mx-6 -mt-4 mb-5 py-8 px-6 text-white text-center rounded-b-2xl"
          style={{ background: `linear-gradient(135deg, ${primary}, #4C1D95)` }}
        >
          <div className="text-2xs uppercase tracking-widest font-semibold opacity-80 mb-1">
            Premium
          </div>
          <h2 className="text-2xl font-bold">Upgrade now</h2>
        </div>
      )}
      {!isPremium && (
        <>
          <h2 className="text-2xl font-bold tracking-tight">
            Upgrade to Premium
          </h2>
          <p className="text-sm opacity-70 mt-1">Ad-free. Unlimited.</p>
        </>
      )}
      <div className="space-y-2 mt-5">
        {trial && (
          <div
            className="rounded-xl p-3 text-left"
            style={{
              background: surface,
              border: `2px dashed ${primary}`,
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: primary }}>
                  Try free for {trial.trial_duration_days} days
                </div>
                <div className="text-sm opacity-70 mt-0.5">
                  Then ${(fallback[0]?.base_price_cents ?? 0) / 100}/
                  {fallback[0]?.interval ?? "month"}
                </div>
              </div>
            </div>
          </div>
        )}
        {fallback.map((p, idx) => (
          <div
            key={p.id}
            className="rounded-xl p-3 flex items-center justify-between"
            style={{
              background: surface,
              border: `${idx === 0 ? "2" : "1"}px solid ${
                idx === 0 ? primary : surfaceBorder
              }`,
            }}
          >
            <div className="text-left">
              <div className="text-sm font-semibold">{p.display_name}</div>
              {idx === 0 && (
                <div
                  className="text-xs font-medium mt-0.5"
                  style={{ color: primary }}
                >
                  Most popular
                </div>
              )}
            </div>
            <div className="text-sm font-semibold tabular-nums">
              ${(p.base_price_cents / 100).toFixed(p.base_price_cents % 100 === 0 ? 0 : 2)}
              {p.interval && (
                <span className="opacity-50 text-xs">/{p.interval}</span>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="w-full rounded-xl py-3 text-white font-semibold text-sm mt-3"
          style={{ background: primary }}
        >
          Continue
        </button>
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
