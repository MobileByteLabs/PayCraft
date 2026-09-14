"use client"

import React, { useEffect, useState } from "react"

/**
 * Which provider ACCOUNT this app bills through.
 *
 * Credentials live on the account, so one Play console serves every app the operator runs; this is
 * where an individual app either follows the account default or pins itself to a specific
 * connection (an agency billing one client through that client's own console).
 *
 * "Follow the account default" is deliberately the first option and the one a new app starts on:
 * an app that follows it picks up a credential rotation with no per-app edit, which is the whole
 * reason the default exists.
 */
export interface ProviderConnection {
  id: string
  provider: string
  label: string
  is_default: boolean
  has_credential: boolean
  apps_using: number
  config: Record<string, unknown>
}

interface Props {
  provider: "google_play" | "app_store"
  /** The connection this app is pinned to, or null when it follows the default. */
  attachedId: string | null
  /** What the app resolves to right now, default included — so the UI states the effect, not the setting. */
  resolvedLabel: string | null
  resolvedViaDefault: boolean
}

export function ProviderAccountPicker({ provider, attachedId, resolvedLabel, resolvedViaDefault }: Props) {
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [selected, setSelected] = useState<string | "">(attachedId ?? "")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/provider-accounts?provider=${provider}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setConnections((j.connections ?? []) as ProviderConnection[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [provider])

  async function apply(next: string) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch("/api/provider-accounts/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, accountId: next === "" ? null : next }),
      })
      const json = (await res.json()) as { error?: string; resolved?: { label?: string; via_default?: boolean } }
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`)
      setSelected(next)
      setNote(
        json.resolved?.via_default
          ? `This app now follows the account default (${json.resolved?.label ?? "none set"}).`
          : `This app now bills through "${json.resolved?.label}".`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function makeDefault(id: string) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch("/api/provider-accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`)
      setConnections((cs) => cs.map((c) => ({ ...c, is_default: c.id === id })))
      // Said plainly because it is not a local change: every app that follows the default moves.
      setNote("Default changed. Every app following the default now uses this connection.")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const defaultLabel = connections.find((c) => c.is_default)?.label ?? "none set"

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h3 className="font-semibold">Billing account</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {resolvedLabel
            ? resolvedViaDefault
              ? `This app follows the account default — ${resolvedLabel}.`
              : `This app bills through ${resolvedLabel}.`
            : "This app has no store credential yet."}
        </p>
      </div>

      <label className="block text-xs text-zinc-500">
        Use connection
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => apply(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Follow the account default ({defaultLabel})</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.is_default ? " — default" : ""}
              {c.has_credential ? "" : " (no key yet)"}
            </option>
          ))}
        </select>
      </label>

      {connections.length > 0 && (
        <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span>
                {c.label} · used by {c.apps_using} app{c.apps_using === 1 ? "" : "s"}
              </span>
              {!c.is_default && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => makeDefault(c.id)}
                  className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Make default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </section>
  )
}
