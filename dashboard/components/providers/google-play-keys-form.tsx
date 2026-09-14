"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Upload } from "lucide-react"

/**
 * Google Play store credentials form. Captures the service-account JSON (paste
 * or file upload) + package name and saves via `/api/providers/google-play/keys`
 * → `tenant_providers_save_store_keys` (encrypted at rest via pgcrypto).
 *
 * The SA JSON is a secret and is never rendered back from the server — when
 * already connected we show only the package name + a "connected" state and let
 * the operator paste a fresh JSON to rotate.
 */
export function GooglePlayKeysForm({
  connected,
  packageName,
  connectionLabel = null,
}: {
  connected: boolean
  packageName: string | null
  /** What this app currently bills through — names the thing a save would OVERWRITE. */
  connectionLabel?: string | null
}) {
  const router = useRouter()
  const [saJson, setSaJson] = useState("")
  const [pkg, setPkg] = useState(packageName ?? "")
  const [accountLabel, setAccountLabel] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  // "Rotate the key on the connection this app uses" vs "connect another Play console" are
  // different intents that produce an identical payload, and inferring one destroys the other:
  // a connection is SHARED, so overwriting it re-points every app attached to it. The operator
  // states which they mean.
  const [createNew, setCreateNew] = useState(false)
  // Set when the server answers 409 — a shared credential needs an explicit yes, with the count.
  const [sharedWarning, setSharedWarning] = useState<number | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setSaJson(text)
    setFileName(file.name)
  }

  async function save(confirmShared = false) {
    setSaving(true)
    setError(null)
    setSaved(false)
    if (!confirmShared) setSharedWarning(null)
    try {
      const res = await fetch("/api/providers/google-play/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service_account_json: saJson,
          package_name: pkg,
          account_label: accountLabel,
          create_new: createNew,
          confirm_shared_overwrite: confirmShared,
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data?.error === "shared_credential_in_use") {
        setSharedWarning(Number(data.appsUsing) || 0)
        return
      }
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setSaved(true)
      setSaJson("")
      setFileName(null)
      setSharedWarning(null)
      setCreateNew(false)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const canSave = createNew
    ? !!saJson && !!pkg                                   // a new connection must bring its own key
    : connected
      ? !!pkg && (!!saJson || pkg !== packageName)
      : !!saJson && !!pkg

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Service account credentials</h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Stored encrypted at rest via pgcrypto.{" "}
          {connected &&
            "Connected — paste a new service-account JSON only if you're rotating it; leave blank to keep the current key."}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Package name
        </label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder="com.example.app"
          value={pkg}
          onChange={(e) => setPkg(e.target.value)}
        />
      </div>

      {connected && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Saving to
          </label>
          <select
            value={createNew ? "new" : "current"}
            onChange={(e) => setCreateNew(e.target.value === "new")}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="current">
              {connectionLabel ? `Update “${connectionLabel}”` : "Update the current connection"}
            </option>
            <option value="new">Connect another Play console (new connection)</option>
          </select>
          <p className="text-[11px] text-ink-500">
            A connection is shared — other apps can bill through it too. Updating replaces its key
            everywhere; connecting another leaves it untouched and points only this app at the new one.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Account label <span className="font-normal normal-case text-ink-400">(optional)</span>
        </label>
        <input
          type="email"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          placeholder="play-console@your-org.iam.gserviceaccount.com"
          value={accountLabel}
          onChange={(e) => setAccountLabel(e.target.value)}
        />
        <p className="text-[11px] text-ink-500">
          The service-account email is auto-detected from the JSON. Set a friendly label only to
          override which account name is shown when reusing this connection across apps.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Service-account JSON
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 hover:text-brand-700 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Upload .json
            <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
          </label>
        </div>
        <textarea
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 min-h-[140px]"
          placeholder={connected ? "Leave blank to keep current key" : '{ "type": "service_account", "client_email": "…", "private_key": "…", … }'}
          value={saJson}
          onChange={(e) => setSaJson(e.target.value)}
        />
        {fileName && (
          <p className="text-[11px] text-ink-500">
            Loaded <span className="font-mono">{fileName}</span> — click save to encrypt & store.
          </p>
        )}
      </div>

      {sharedWarning !== null && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-lg space-y-2">
          <p>
            <strong>
              {sharedWarning} apps bill through{connectionLabel ? ` “${connectionLabel}”` : " this connection"}.
            </strong>{" "}
            Replacing its key moves all {sharedWarning} to the new Play console. If you meant to add a
            second console, choose <em>Connect another Play console</em> above instead.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => save(true)}
              className="px-3 py-1 text-[11px] font-bold bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Replace for all {sharedWarning} apps
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
        {saved ? (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Saved — Play credentials encrypted
          </span>
        ) : (
          <span />
        )}
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
          ) : createNew ? (
            "Connect new console"
          ) : connected ? (
            "Update credentials"
          ) : (
            "Save credentials"
          )}
        </button>
      </div>
    </div>
  )
}
