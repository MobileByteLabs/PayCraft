"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Eye, EyeOff, Loader2 } from "lucide-react"

interface KeyPair {
  app_id: string
  secret_key: string
  webhook_secret: string
}

const EMPTY: KeyPair = { app_id: "", secret_key: "", webhook_secret: "" }

/**
 * Cashfree credentials capture form. Mirrors the Stripe / Razorpay Manual
 * Keys flow — separate test + live key pairs, partial-update mode when
 * already connected. Saves via `/api/providers/cashfree/keys` which calls
 * `tenant_providers_save_keys` / `_update_keys` depending on whether a row
 * already exists.
 */
export function CashfreeKeysForm({
  tenantId,
  connected,
  testKeyId,
  liveKeyId,
}: {
  tenantId: string
  connected: boolean
  testKeyId: string | null
  liveKeyId: string | null
}) {
  const router = useRouter()
  const [test, setTest] = useState<KeyPair>(EMPTY)
  const [live, setLive] = useState<KeyPair>(EMPTY)
  const [showLive, setShowLive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/providers/cashfree/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test_app_id: test.app_id,
          test_secret_key: test.secret_key,
          test_webhook_secret: test.webhook_secret,
          live_app_id: showLive ? live.app_id : "",
          live_secret_key: showLive ? live.secret_key : "",
          live_webhook_secret: showLive ? live.webhook_secret : "",
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const isUpdate = connected
  const testFilled = test.app_id && test.secret_key && test.webhook_secret
  const anyTouched =
    test.app_id ||
    test.secret_key ||
    test.webhook_secret ||
    (showLive && (live.app_id || live.secret_key || live.webhook_secret))
  const canSave = isUpdate ? !!anyTouched : !!testFilled

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink-900">API credentials</h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Stored encrypted at rest via pgcrypto.{" "}
          {isUpdate &&
            "Partial update mode — leave fields blank to keep existing values; only fill the ones you're changing."}
        </p>
      </div>

      {isUpdate && (
        <div className="grid grid-cols-2 gap-3">
          <ConnectedHint label="Test app ID" value={testKeyId} />
          <ConnectedHint label="Live app ID" value={liveKeyId} />
        </div>
      )}

      <KeyTriplet
        label="Test keys"
        value={test}
        onChange={setTest}
        isUpdate={isUpdate}
      />

      <div className="pt-2 border-t border-ink-100">
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={showLive}
            onChange={(e) => setShowLive(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <div className="text-sm font-semibold text-ink-900">
              {isUpdate ? "Also update live keys" : "Also configure live keys"}
            </div>
            <div className="text-xs text-ink-500">
              {isUpdate
                ? "Only tick to overwrite the live values too."
                : "Optional — add later when you're ready for production."}
            </div>
          </div>
        </label>
        {showLive && (
          <KeyTriplet
            label="Live keys"
            value={live}
            onChange={setLive}
            isUpdate={isUpdate}
          />
        )}
      </div>

      {error && (
        <div className="text-xs text-danger-700 font-mono bg-danger-50 border border-danger-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-ink-100">
        {saved && (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Saved — Cashfree credentials encrypted
          </span>
        )}
        {!saved && <span />}
        <button
          onClick={save}
          disabled={!canSave || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed ml-auto"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
          ) : isUpdate ? (
            "Update keys"
          ) : (
            "Save keys"
          )}
        </button>
      </div>
    </div>
  )
}

function ConnectedHint({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="bg-ink-50 border border-ink-200 rounded-lg px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
        {label}
      </div>
      {value ? (
        <code className="text-[11px] font-mono text-ink-700">{value}</code>
      ) : (
        <span className="text-[11px] text-ink-400">Not configured</span>
      )}
    </div>
  )
}

function KeyTriplet({
  label,
  value,
  onChange,
  isUpdate,
}: {
  label: string
  value: KeyPair
  onChange: (v: KeyPair) => void
  isUpdate: boolean
}) {
  const [showSecret, setShowSecret] = useState(false)
  const keep = isUpdate ? "Leave blank to keep current" : null
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-bold text-ink-700">{label}</h4>
      <Field label="App ID">
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={keep ?? "TEST… / PROD…"}
          value={value.app_id}
          onChange={(e) => onChange({ ...value, app_id: e.target.value })}
        />
      </Field>
      <Field label="Secret key">
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 pr-10"
            placeholder={keep ?? "cfsk_…"}
            value={value.secret_key}
            onChange={(e) => onChange({ ...value, secret_key: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </Field>
      <Field label="Webhook secret">
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={keep ?? "whsec_…"}
          value={value.webhook_secret}
          onChange={(e) => onChange({ ...value, webhook_secret: e.target.value })}
        />
      </Field>
    </div>
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
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
        {label}
      </label>
      {children}
    </div>
  )
}
