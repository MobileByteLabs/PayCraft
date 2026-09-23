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
  const [accountLabel, setAccountLabel] = useState("")
  const [showLive, setShowLive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [sharedWarning, setSharedWarning] = useState<number | null>(null)

  async function save(confirmShared = false, createNew = false) {
    setSaving(true)
    setError(null)
    setSaved(false)
    if (!confirmShared) setSharedWarning(null)
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
          account_label: accountLabel,
          confirm_shared_overwrite: confirmShared,
          create_new: createNew,
        }),
      })
      const data = await res.json()
      // See app-store-keys-form: the 409 is the RPC asking whether a rotation across every app
      // sharing these keys is intended. Falling through to setError would show the operator the
      // raw `shared_credential_in_use` string with no way to answer.
      if (res.status === 409 && data?.error === "shared_credential_in_use") {
        setSharedWarning(Number(data.appsUsing) || 0)
        return
      }
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setSharedWarning(null)
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

      <Field label="Account label / email (optional)">
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          placeholder="team@your-org.com — shown when reusing this connection"
          value={accountLabel}
          onChange={(e) => setAccountLabel(e.target.value)}
        />
      </Field>

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

      {sharedWarning !== null && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-lg space-y-2">
          <p>
            <strong>
              {sharedWarning} other app{sharedWarning === 1 ? "" : "s"} bill through these Cashfree
              keys.
            </strong>{" "}
            Replacing them moves all {sharedWarning} to the new Cashfree account. To connect a
            second account instead, give this one a different account label.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => save(true)}
              disabled={saving}
              className="px-3 py-1 text-[11px] font-bold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
            >
              Replace for all {sharedWarning} apps
            </button>
            <button
              onClick={() => save(false, true)}
              disabled={saving}
              className="px-3 py-1 text-[11px] font-bold border border-amber-400 text-amber-900 rounded hover:bg-amber-100 disabled:opacity-50"
            >
              Connect as a separate account
            </button>
            <button
              onClick={() => setSharedWarning(null)}
              className="px-3 py-1 text-[11px] font-bold border border-amber-300 rounded hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
          onClick={() => save()}
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
