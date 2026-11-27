"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { Loader2, Megaphone } from "lucide-react"

/**
 * Attribution forwarding (migration 208): PayCraft's server sends this app's verified purchases, trial
 * starts, renewals and refunds to GA4 (Firebase Measurement Protocol) and AppsFlyer (S2S events), so ad
 * campaigns optimise for buyers and renewals are counted. The app calls `PayCraft.setAttributionIds(...)`.
 *
 * The secrets are write-only: they are never sent back, so a connected platform shows only its id and an
 * empty secret field ("leave blank to keep").
 */
type Status = { ga4: { firebase_app_id?: string } | null; appsflyer: { app_id?: string } | null }

const inputClass =
  "w-full border border-ink-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none px-3 py-2 font-mono transition-all bg-white"
const labelClass = "block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1"

const MESSAGES: Record<string, string> = {
  secret_required: "Enter the secret — it is required the first time.",
  bad_firebase_app_id: "That is not a Firebase app id (1:123…:android:abc…).",
  bad_app_id: "Use the Android package name or the iOS id (id123456789).",
  forbidden: "Only an admin of this app can change this.",
}

export function AttributionCard() {
  const { tenantId } = useDashboard()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ["attribution", tenantId],
    queryFn: async () => {
      const res = await fetch("/api/settings/attribution")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Couldn't load (${res.status})`)
      return body as Status
    },
  })
  const status = statusQuery.data ?? null
  const load = () => queryClient.invalidateQueries({ queryKey: ["attribution", tenantId] })

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-6 space-y-5" data-testid="attribution-card">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="w-4 h-4 text-ink-400" strokeWidth={2} />
          <h3 className="text-sm font-bold text-ink-900">Ad attribution</h3>
        </div>
        <p className="text-xs text-ink-500">
          Send verified purchases, trial starts, renewals and refunds to your ad platforms, server-side — renewals
          and refunds never reach the app. Your app passes its ids with{" "}
          <span className="font-mono">PayCraft.setAttributionIds(…)</span>. Secrets are stored encrypted and never
          shown again.
        </p>
      </div>
      {statusQuery.isPending && (
        <div role="status" aria-busy="true" className="space-y-3 animate-pulse">
          <span className="sr-only">Loading ad attribution…</span>
          <div className="h-24 rounded-lg bg-ink-100" />
          <div className="h-24 rounded-lg bg-ink-100" />
        </div>
      )}
      {statusQuery.isError && (
        <p role="alert" className="text-xs text-danger-700">
          Couldn&rsquo;t load ad attribution: {statusQuery.error.message}{" "}
          <button type="button" onClick={() => statusQuery.refetch()} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}
      {statusQuery.isSuccess && (
        <>
      <PlatformForm
        platform="ga4"
        title="Google Analytics 4 / Firebase"
        idLabel="Firebase app id"
        idKey="firebase_app_id"
        idPlaceholder="1:123456789012:android:abc123def456"
        secretLabel="Measurement Protocol API secret"
        secretKey="api_secret"
        savedId={status?.ga4?.firebase_app_id ?? null}
        onChange={load}
      />
      <PlatformForm
        platform="appsflyer"
        title="AppsFlyer"
        idLabel="App id"
        idKey="app_id"
        idPlaceholder="com.example.app or id123456789"
        secretLabel="Dev key"
        secretKey="dev_key"
        savedId={status?.appsflyer?.app_id ?? null}
        onChange={load}
      />
        </>
      )}
    </div>
  )
}

function PlatformForm(props: {
  platform: "ga4" | "appsflyer"
  title: string
  idLabel: string
  idKey: string
  idPlaceholder: string
  secretLabel: string
  secretKey: string
  savedId: string | null
  onChange: () => Promise<unknown>
}) {
  const connected = props.savedId !== null
  const [appId, setAppId] = useState("")
  const [secret, setSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setAppId(props.savedId ?? "")
  }, [props.savedId])

  async function call(init: RequestInit, url = "/api/settings/attribution", done: string) {
    setBusy(true)
    setNote(null)
    setFailed(false)
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailed(true)
        setNote(MESSAGES[body?.error] ?? body?.error ?? "Couldn't save — try again.")
        return
      }
      setSecret("")
      setNote(done)
      await props.onChange()
    } catch (e: any) {
      setFailed(true)
      setNote(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    call(
      { method: "PUT", body: JSON.stringify({ platform: props.platform, [props.idKey]: appId, [props.secretKey]: secret }) },
      undefined,
      "Saved.",
    )
  const clear = () => call({ method: "DELETE" }, `/api/settings/attribution?platform=${props.platform}`, "Removed.")

  return (
    <div className="rounded-lg border border-ink-100 p-4 space-y-3" data-testid={`attribution-${props.platform}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">{props.title}</p>
        <span className={`text-[10px] font-bold uppercase ${connected ? "text-emerald-700" : "text-ink-400"}`}>
          {connected ? "Connected" : "Not set"}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{props.idLabel}</label>
          <input className={inputClass} value={appId} placeholder={props.idPlaceholder} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{props.secretLabel}</label>
          <input
            type="password"
            autoComplete="off"
            className={inputClass}
            value={secret}
            placeholder={connected ? "Leave blank to keep the saved one" : "Required"}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {busy && (
          <span role="status" className="text-[11px] text-ink-500 mr-auto flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving…
          </span>
        )}
        {!busy && note && (
          <span role={failed ? "alert" : undefined} className={`text-[11px] mr-auto ${failed ? "text-danger-700" : "text-ink-600"}`}>
            {note}
          </span>
        )}
        {connected && (
          <button
            type="button"
            disabled={busy}
            onClick={clear}
            className="px-3 py-1.5 text-xs font-semibold border border-ink-200 rounded-lg hover:bg-ink-50 disabled:opacity-60"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          disabled={busy || !appId || (!connected && !secret)}
          onClick={save}
          className="px-4 py-1.5 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {connected ? "Update" : "Save"}
        </button>
      </div>
    </div>
  )
}
