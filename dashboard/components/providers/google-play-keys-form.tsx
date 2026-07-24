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
}: {
  connected: boolean
  packageName: string | null
}) {
  const router = useRouter()
  const [saJson, setSaJson] = useState("")
  const [pkg, setPkg] = useState(packageName ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setSaJson(text)
    setFileName(file.name)
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/providers/google-play/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service_account_json: saJson,
          package_name: pkg,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setSaved(true)
      setSaJson("")
      setFileName(null)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const canSave = connected ? !!pkg && (!!saJson || pkg !== packageName) : !!saJson && !!pkg

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
          onClick={save}
          disabled={!canSave || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed ml-auto"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
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
