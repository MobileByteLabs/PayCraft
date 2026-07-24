"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Upload } from "lucide-react"

/**
 * App Store Connect store credentials form. Captures the .p8 private key (paste
 * or file upload) + key id / issuer id / bundle id and saves via
 * `/api/providers/app-store/keys` → `tenant_providers_save_store_keys`
 * (encrypted at rest via pgcrypto).
 *
 * The .p8 is a secret and is never rendered back from the server — when already
 * connected we show only the non-secret ids and let the operator paste a fresh
 * key to rotate.
 */
export function AppStoreKeysForm({
  connected,
  keyId,
  issuerId,
  bundleId,
}: {
  connected: boolean
  keyId: string | null
  issuerId: string | null
  bundleId: string | null
}) {
  const router = useRouter()
  const [p8, setP8] = useState("")
  const [kid, setKid] = useState(keyId ?? "")
  const [iss, setIss] = useState(issuerId ?? "")
  const [bid, setBid] = useState(bundleId ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setP8(text)
    setFileName(file.name)
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/providers/app-store/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          p8_key: p8,
          key_id: kid,
          issuer_id: iss,
          bundle_id: bid,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setSaved(true)
      setP8("")
      setFileName(null)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const idsFilled = !!kid && !!iss && !!bid
  const canSave = connected ? idsFilled : idsFilled && !!p8

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink-900">App Store Connect API key</h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Stored encrypted at rest via pgcrypto.{" "}
          {connected &&
            "Connected — paste a new .p8 only if you're rotating it; leave blank to keep the current key."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Key ID">
          <input
            type="text"
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
            placeholder="2X9R4HXF34"
            value={kid}
            onChange={(e) => setKid(e.target.value)}
          />
        </Field>
        <Field label="Issuer ID">
          <input
            type="text"
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
            placeholder="57246542-96fe-1a63-…"
            value={iss}
            onChange={(e) => setIss(e.target.value)}
          />
        </Field>
        <Field label="Bundle ID">
          <input
            type="text"
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
            placeholder="com.example.app"
            value={bid}
            onChange={(e) => setBid(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Private key (.p8)
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 hover:text-brand-700 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Upload .p8
            <input type="file" accept=".p8,application/x-pem-file,text/plain" className="hidden" onChange={onFile} />
          </label>
        </div>
        <textarea
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 min-h-[120px]"
          placeholder={connected ? "Leave blank to keep current key" : "Paste the full App Store Connect .p8 private key (PKCS#8 PEM)"}
          value={p8}
          onChange={(e) => setP8(e.target.value)}
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
            Saved — App Store credentials encrypted
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
        {label}
      </label>
      {children}
    </div>
  )
}
