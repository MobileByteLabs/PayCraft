"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  QrCode,
  Smartphone,
} from "lucide-react"

interface UpiConfig {
  vpa: string
  display_name: string
  merchant_code?: string
  verification_mode?: "manual" | "polling" | "psp_webhook"
}

type Status = "idle" | "saving" | "saved" | "error"

/**
 * UPI Direct configuration form. The merchant enters:
 *   - VPA (their `username@bank` handle — personal or business)
 *   - Display name (what customers see in their UPI app at confirm time)
 *   - Optional MCC (merchant category code — improves recognition for
 *     business UPI; can be blank for personal accounts)
 *   - Verification mode (how PayCraft confirms the payment arrived)
 *
 * Saves via `tenant_payment_methods_upsert` RPC. After save, renders a
 * live preview of what the generated UPI link will look like, plus the
 * test/preview UPI URI the merchant can scan with their own UPI app to
 * sanity-check end-to-end before exposing to customers.
 */
export function UpiSetupForm({
  tenantId,
  initial,
  enabled: initialEnabled,
}: {
  tenantId: string
  initial: UpiConfig | null
  enabled: boolean
}) {
  const router = useRouter()
  const [vpa, setVpa] = useState(initial?.vpa ?? "")
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "")
  const [merchantCode, setMerchantCode] = useState(initial?.merchant_code ?? "")
  const [mode, setMode] = useState<"manual" | "polling" | "psp_webhook">(
    initial?.verification_mode ?? "manual",
  )
  const [enabled, setEnabled] = useState(initialEnabled)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Live-preview of the URL the SDK will generate at checkout time.
  const preview = buildPreviewLink({
    vpa,
    display_name: displayName || "Merchant",
    merchant_code: merchantCode || undefined,
  })
  const vpaError = vpa && !isValidVpa(vpa)

  async function save() {
    setStatus("saving")
    setError(null)
    try {
      const config: UpiConfig = {
        vpa: vpa.trim(),
        display_name: displayName.trim(),
        merchant_code: merchantCode.trim() || undefined,
        verification_mode: mode,
      }
      const res = await fetch("/api/providers/upi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, config }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "Save failed")
        setStatus("error")
        return
      }
      setStatus("saved")
      router.refresh()
      setTimeout(() => setStatus("idle"), 2500)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStatus("error")
    }
  }

  const canSave = !!(vpa && displayName && !vpaError)

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900">Your UPI handle</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Paste the VPA you want customers' payments to land in. This is the
            same handle you give friends on Google Pay / PhonePe — looks like
            <code className="ml-1 font-mono bg-ink-100 px-1 rounded">
              name@oksbi
            </code>{" "}
            or{" "}
            <code className="font-mono bg-ink-100 px-1 rounded">
              business@axisbank
            </code>
            .
          </p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-xs font-semibold text-ink-700">
            Enabled
          </span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            VPA (UPI ID)
          </label>
          <input
            type="text"
            value={vpa}
            onChange={(e) => setVpa(e.target.value)}
            placeholder="merchant@oksbi"
            className={`w-full px-4 py-2.5 bg-ink-50 border rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 ${
              vpaError ? "border-danger-300" : "border-ink-200"
            }`}
          />
          {vpaError && (
            <p className="text-[11px] text-danger-700 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Not a valid VPA — expected{" "}
              <code className="font-mono">name@bank</code>
            </p>
          )}
          <p className="text-[11px] text-ink-400">
            Find yours in any UPI app under Profile → "My UPI ID".
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="MobileByteSensei"
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          />
          <p className="text-[11px] text-ink-400">
            Shown in the customer's UPI app at confirm time. Use your brand,
            not your personal name.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            MCC (optional)
          </label>
          <input
            type="text"
            value={merchantCode}
            onChange={(e) =>
              setMerchantCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
            }
            placeholder="5411"
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          />
          <p className="text-[11px] text-ink-400">
            4-digit Merchant Category Code if you have a business VPA. Skip for
            personal accounts.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Verification mode
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="manual">Manual — I'll confirm in the dashboard</option>
            <option value="polling" disabled>
              Polling — read-only bank API (coming soon)
            </option>
            <option value="psp_webhook" disabled>
              PSP webhook — Razorpay listener (coming soon)
            </option>
          </select>
          <p className="text-[11px] text-ink-400">
            How PayCraft knows a UPI payment landed. Manual is fine for low
            volume; switch to polling once you cross ~50 txns/day.
          </p>
        </div>
      </div>

      {/* Live preview of what the SDK will generate */}
      <div className="border-t border-ink-100 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-ink-700 flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5" />
            Preview — UPI link for a ₹999 purchase
          </h4>
          <button
            onClick={() => {
              navigator.clipboard.writeText(preview)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            disabled={!canSave}
            className="text-[10px] font-bold text-brand-600 hover:text-brand-700 disabled:opacity-40 flex items-center gap-1"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <code className="block bg-ink-50 border border-ink-200 px-3 py-2 rounded font-mono text-[11px] text-ink-800 break-all">
          {canSave ? preview : "Fill in VPA + display name to preview"}
        </code>
        <p className="text-[10px] text-ink-400 mt-1.5 leading-relaxed flex items-center gap-1.5">
          <QrCode className="w-3 h-3 flex-shrink-0" />
          On Android, tapping this URL opens the UPI app picker. On iOS /
          desktop, the SDK renders it as a QR code for the customer to scan.
          Scan it with your own UPI app once you save below to verify
          end-to-end.
        </p>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-ink-100">
        {error && (
          <span className="text-xs text-danger-700 font-mono">{error}</span>
        )}
        {status === "saved" && (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Saved — UPI Direct is now live in your routing options
          </span>
        )}
        {status === "idle" && !error && <span />}
        <button
          onClick={save}
          disabled={!canSave || status === "saving"}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed ml-auto"
        >
          {status === "saving" ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save UPI config"
          )}
        </button>
      </div>
    </div>
  )
}

// Lightweight client-side mirrors of lib/upi.ts — duplicated here so the
// preview renders without an HTTP round-trip. Keep in sync with the server
// implementation; the server is the truth at checkout time.

const VPA_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/

function isValidVpa(vpa: string): boolean {
  if (!vpa) return false
  if (vpa.length < 5 || vpa.length > 100) return false
  return VPA_REGEX.test(vpa)
}

function buildPreviewLink(config: {
  vpa: string
  display_name: string
  merchant_code?: string
}): string {
  if (!isValidVpa(config.vpa)) return ""
  const u = new URL("upi://pay")
  u.searchParams.set("pa", config.vpa)
  u.searchParams.set("pn", config.display_name)
  u.searchParams.set("am", "999.00")
  u.searchParams.set("cu", "INR")
  u.searchParams.set("tn", "PayCraft sample purchase")
  u.searchParams.set("tr", "PCxxxxxx-xxxxxx-PREVIEW")
  if (config.merchant_code) {
    u.searchParams.set("mc", config.merchant_code)
    u.searchParams.set("mode", "02")
  }
  return u.toString().replace(/^upi%3A\/\//, "upi://")
}
