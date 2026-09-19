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
  reviewScreenshotUrl,
  connectionLabel = null,
}: {
  connected: boolean
  keyId: string | null
  issuerId: string | null
  bundleId: string | null
  reviewScreenshotUrl?: string | null
  /** What this app currently bills through — names the thing a save would OVERWRITE. */
  connectionLabel?: string | null
}) {
  const router = useRouter()
  const [p8, setP8] = useState("")
  // Rotating this team's key and connecting a second App Store Connect team produce an identical
  // payload, and a connection is SHARED — inferring the wrong one re-points every app using it.
  const [createNew, setCreateNew] = useState(false)
  const [sharedWarning, setSharedWarning] = useState<number | null>(null)
  const [kid, setKid] = useState(keyId ?? "")
  const [iss, setIss] = useState(issuerId ?? "")
  const [bid, setBid] = useState(bundleId ?? "")
  const [accountLabel, setAccountLabel] = useState("")
  const [reviewShot, setReviewShot] = useState(reviewScreenshotUrl ?? "")
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

  async function save(confirmShared = false) {
    setSaving(true)
    setError(null)
    setSaved(false)
    if (!confirmShared) setSharedWarning(null)
    try {
      const res = await fetch("/api/providers/app-store/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          p8_key: p8,
          key_id: kid,
          issuer_id: iss,
          bundle_id: bid,
          account_label: accountLabel,
          review_screenshot_url: reviewShot,
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
      setP8("")
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

  const idsFilled = !!kid && !!iss && !!bid
  const canSave = createNew ? idsFilled && !!p8 : connected ? idsFilled : idsFilled && !!p8

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 space-y-5">
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
            <option value="new">Connect another App Store team (new connection)</option>
          </select>
          <p className="text-[11px] text-ink-500">
            A connection is shared — other apps can bill through it too. Updating replaces its key
            everywhere; connecting another leaves it untouched and points only this app at the new one.
          </p>
        </div>
      )}

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
        <Field label="Application ID">
          <input
            type="text"
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
            placeholder="com.example.app"
            value={bid}
            onChange={(e) => setBid(e.target.value)}
          />
        <p className="text-[11px] text-ink-500">
          One value for both platforms — the Android package name and the iOS bundle ID are the
          same string. Saving it here updates it for the other store too.
        </p>
        </Field>

        <Field label="Review screenshot URL">
          <input
            type="url"
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
            placeholder="https://…/paywall.png"
            value={reviewShot}
            onChange={(e) => setReviewShot(e.target.value)}
          />
          <p className="text-[11px] text-ink-500">
            App Store requires one screenshot per subscription — without it they stay in{" "}
            <span className="font-mono">MISSING_METADATA</span> and cannot be submitted, however
            complete everything else is.{" "}
            <strong className="font-semibold text-ink-700">Optional:</strong> leave this blank and
            product sync renders one from your live paywall — same hero, plans and prices the SDK
            serves, so it cannot go stale when you edit a price. Set a URL only to override it with
            a real capture of the shipped app.{" "}
            <a
              href="/api/paywall/review-screenshot"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 underline"
            >
              Preview the generated screenshot
            </a>
          </p>
        </Field>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Account label / email <span className="font-normal normal-case text-ink-400">(optional)</span>
        </label>
        <input
          type="text"
          className="w-full px-4 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          placeholder="team@your-org.com — shown when reusing this connection"
          value={accountLabel}
          onChange={(e) => setAccountLabel(e.target.value)}
        />
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

      {sharedWarning !== null && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-lg space-y-2">
          <p>
            <strong>
              {sharedWarning} apps bill through{connectionLabel ? ` “${connectionLabel}”` : " this connection"}.
            </strong>{" "}
            Replacing its key moves all {sharedWarning} to the new App Store team. If you meant to add a
            second team, choose <em>Connect another App Store team</em> above instead.
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
            Saved — App Store credentials encrypted
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
