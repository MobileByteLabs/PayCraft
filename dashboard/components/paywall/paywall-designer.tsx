"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

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

const TEMPLATES = [
  {
    name: "minimal",
    label: "Minimal",
    description: "Clean, no-frills paywall. Best for productivity apps.",
  },
  {
    name: "premium",
    label: "Premium",
    description: "Polished gradient header + structured benefits.",
  },
  {
    name: "dark",
    label: "Dark",
    description: "Dark-mode-first paywall. Best for media & entertainment.",
  },
]

export function PaywallDesigner({
  initial,
  canRemoveAttribution,
  plan,
}: {
  initial: PaywallConfig
  canRemoveAttribution: boolean
  plan: string
}) {
  const router = useRouter()
  const [cfg, setCfg] = useState<PaywallConfig>(initial)
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
      <div className="space-y-6">
        <Section title="Template">
          <div className="space-y-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setCfg({ ...cfg, template: t.name })}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  cfg.template === t.name
                    ? "border-brand-600 ring-2 ring-brand-100"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="font-medium text-gray-900">{t.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t.description}
                </div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Theme">
          <Field label="Primary color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cfg.primary_color ?? "#6B4FE3"}
                onChange={(e) =>
                  setCfg({ ...cfg, primary_color: e.target.value })
                }
                className="h-9 w-12 rounded border border-gray-200"
              />
              <input
                value={cfg.primary_color ?? "#6B4FE3"}
                onChange={(e) =>
                  setCfg({ ...cfg, primary_color: e.target.value })
                }
                className="rounded border border-gray-300 px-2 py-1.5 text-sm font-mono w-32"
              />
            </div>
          </Field>
          <Field label="Font family">
            <select
              value={cfg.font_family ?? "Inter"}
              onChange={(e) =>
                setCfg({ ...cfg, font_family: e.target.value })
              }
              className="rounded border border-gray-300 px-3 py-1.5 text-sm w-full"
            >
              <option value="Inter">Inter (default)</option>
              <option value="Roboto">Roboto</option>
              <option value="System">System default</option>
              <option value="SF Pro">SF Pro</option>
            </select>
          </Field>
        </Section>

        <Section title="Branding">
          <div className="space-y-2">
            {[
              {
                value: "attribution" as const,
                label: "Powered by PayCraft by MobileByteSensei",
                desc: "Free tier default",
              },
              {
                value: "none" as const,
                label: "No footer",
                desc: canRemoveAttribution
                  ? "Pro+ tier"
                  : "Locked — upgrade to Pro to enable",
                disabled: !canRemoveAttribution,
              },
              {
                value: "custom" as const,
                label: "Custom footer",
                desc: canRemoveAttribution
                  ? "Enterprise tier"
                  : "Locked — upgrade to Pro to enable",
                disabled: !canRemoveAttribution,
              },
            ].map((b) => (
              <label
                key={b.value}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  b.disabled
                    ? "opacity-50 cursor-not-allowed border-gray-200"
                    : cfg.branding === b.value
                    ? "border-brand-600 ring-2 ring-brand-100 cursor-pointer"
                    : "border-gray-200 hover:bg-gray-50 cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="branding"
                  checked={cfg.branding === b.value}
                  onChange={() =>
                    !b.disabled && setCfg({ ...cfg, branding: b.value })
                  }
                  disabled={b.disabled}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {b.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{b.desc}</div>
                </div>
              </label>
            ))}
            {cfg.branding === "custom" && canRemoveAttribution && (
              <input
                value={cfg.custom_footer ?? ""}
                onChange={(e) =>
                  setCfg({ ...cfg, custom_footer: e.target.value })
                }
                placeholder="Custom footer text"
                className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-sm w-full"
              />
            )}
          </div>
        </Section>

        <Section title="Support email">
          <input
            type="email"
            value={cfg.support_email ?? ""}
            onChange={(e) => setCfg({ ...cfg, support_email: e.target.value })}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm w-full"
            placeholder="support@yourapp.com"
          />
        </Section>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-brand-600 text-white px-5 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save paywall"}
          </button>
          {savedAt && (
            <span className="text-xs text-gray-500">Saved at {savedAt}</span>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Preview</h3>
        <PaywallPreview cfg={cfg} plan={plan} />
      </div>
    </div>
  )
}

function PaywallPreview({ cfg, plan }: { cfg: PaywallConfig; plan: string }) {
  const bg = cfg.template === "dark" ? "#121212" : "#FAFAFA"
  const fg = cfg.template === "dark" ? "#FFFFFF" : "#0F172A"
  const surface = cfg.template === "dark" ? "#1E1E1E" : "#FFFFFF"

  const showFooter = (() => {
    const tierForcesAttribution = plan === "free"
    if (tierForcesAttribution) return "attribution"
    return cfg.branding
  })()

  return (
    <div
      className="rounded-xl overflow-hidden border border-gray-200 shadow-sm"
      style={{
        background: bg,
        color: fg,
        fontFamily: cfg.font_family ?? "Inter, system-ui, sans-serif",
      }}
    >
      <div className="px-6 py-12 text-center">
        <h2 className="text-2xl font-bold mb-2">Upgrade to Premium</h2>
        <p className="text-sm opacity-70 mb-6">
          {cfg.template === "premium"
            ? "Unlock the full experience."
            : "Ad-free. Unlimited."}
        </p>
        <div className="space-y-3 max-w-sm mx-auto">
          {[
            { name: "Monthly", price: "$1.99" },
            { name: "Yearly", price: "$19.99", popular: true },
          ].map((plan) => (
            <div
              key={plan.name}
              className="rounded-lg p-3 flex items-center justify-between"
              style={{
                background: surface,
                border:
                  cfg.template === "premium" && plan.popular
                    ? `2px solid ${cfg.primary_color ?? "#6B4FE3"}`
                    : `1px solid ${cfg.template === "dark" ? "#333" : "#E5E7EB"}`,
              }}
            >
              <div className="text-left">
                <div className="font-medium">{plan.name}</div>
                {plan.popular && (
                  <div
                    className="text-xs font-medium mt-0.5"
                    style={{ color: cfg.primary_color ?? "#6B4FE3" }}
                  >
                    Most popular
                  </div>
                )}
              </div>
              <div className="text-base font-semibold">{plan.price}</div>
            </div>
          ))}
          <button
            type="button"
            className="w-full rounded-lg py-3 text-white font-medium"
            style={{ background: cfg.primary_color ?? "#6B4FE3" }}
          >
            Continue
          </button>
        </div>
        {showFooter === "attribution" && (
          <div className="mt-6 text-xs opacity-50">
            Powered by PayCraft by MobileByteSensei
          </div>
        )}
        {showFooter === "custom" && cfg.custom_footer && (
          <div className="mt-6 text-xs opacity-50">{cfg.custom_footer}</div>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
