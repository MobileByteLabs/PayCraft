"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { Loader2, Timer } from "lucide-react"

/**
 * How quickly dashboard changes reach devices.
 *
 * Deliberately framed as propagation delay rather than "cache TTL": the number an operator cares
 * about is "I fixed a price — when will buyers see it?", and every support conversation about the
 * old hardcoded hour was really that question asked in caching vocabulary.
 *
 * Presets rather than a free number field for the common cases, with a number input for the rest.
 * The server clamps to 30..86400 and returns what it STORED, which is what this renders — so a value
 * outside the range visibly lands on the nearest legal one instead of appearing to have been saved.
 */
const PRESETS = [
  { label: "1 min", seconds: 60, note: "Fastest — while actively iterating" },
  { label: "5 min", seconds: 300, note: "Default — changes land in minutes" },
  { label: "1 hour", seconds: 3600, note: "Fewer requests, slower propagation" },
  { label: "24 hours", seconds: 86400, note: "Stable catalogue, rarely edited" },
]

function humanize(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${seconds} sec`
}

export function ConfigTtlCard() {
  const { tenantId } = useDashboard()
  const queryClient = useQueryClient()
  const queryKey = ["config-ttl", tenantId]
  const ttlQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch("/api/settings/config-ttl")
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `Couldn't load (${res.status})`)
      return (d?.seconds ?? null) as number | null
    },
  })
  const seconds = ttlQuery.data ?? null
  const setSeconds = (v: number) => queryClient.setQueryData(queryKey, v)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function save(next: number) {
    setSaving(true)
    setNote(null)
    setFailed(false)
    try {
      const res = await fetch("/api/settings/config-ttl", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seconds: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailed(true)
        setNote(body?.error ?? "Couldn't save — try again.")
        return
      }
      // Render what was STORED, not what was asked for: the server clamps, and showing the request
      // would quietly misreport the live value.
      setSeconds(body.seconds)
      setNote(
        body.seconds !== next
          ? `Clamped to ${humanize(body.seconds)} — the allowed range is 30 sec to 24 hours.`
          : `Saved — changes now reach devices within ${humanize(body.seconds)}.`,
      )
    } catch (e: any) {
      setFailed(true)
      setNote(String(e?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Timer className="w-4 h-4 text-ink-400" strokeWidth={2} />
        <h3 className="text-sm font-bold text-ink-900">Change propagation</h3>
      </div>
      <p className="text-xs text-ink-500 mb-4">
        How long a device may use its cached configuration before checking for changes. Prices,
        paywall copy, providers and routing all come from here, so this is how quickly an edit
        reaches buyers.{" "}
        {seconds !== null && (
          <span className="text-ink-700 font-semibold">Currently {humanize(seconds)}.</span>
        )}
        {ttlQuery.isPending && (
          <span role="status" aria-busy="true" className="inline-block h-3 w-24 rounded bg-ink-100 animate-pulse align-middle" />
        )}
        {ttlQuery.isError && (
          <span role="alert" className="text-danger-700">
            Couldn&rsquo;t load the current value: {ttlQuery.error.message}{" "}
            <button type="button" onClick={() => ttlQuery.refetch()} className="font-semibold underline">
              Retry
            </button>
          </span>
        )}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PRESETS.map((p) => {
          const active = seconds === p.seconds
          return (
            <button
              key={p.seconds}
              type="button"
              disabled={saving}
              onClick={() => save(p.seconds)}
              title={p.note}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                active
                  ? "border-brand-500 bg-brand-50 text-brand-800"
                  : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"
              } ${saving ? "opacity-60" : ""}`}
            >
              <div className="text-xs font-bold">{p.label}</div>
              <div className="text-[10px] text-ink-500 leading-tight mt-0.5">{p.note}</div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 mt-4">
        <label className="text-[11px] text-ink-500">Custom (seconds)</label>
        <input
          type="number"
          min={30}
          max={86400}
          key={seconds ?? "unset"}
          disabled={saving}
          defaultValue={seconds ?? 300}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v) && v !== seconds) void save(v)
          }}
          className="w-28 rounded border border-ink-200 px-2 py-1 text-xs tabular-nums"
        />
        <span className="text-[11px] text-ink-400">30 – 86400</span>
      </div>

      {saving && (
        <p role="status" className="text-[11px] text-ink-500 mt-3 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </p>
      )}
      {note && (
        <p role={failed ? "alert" : undefined} className={`text-[11px] mt-3 ${failed ? "text-danger-700" : "text-ink-600"}`}>
          {note}
        </p>
      )}
    </div>
  )
}
