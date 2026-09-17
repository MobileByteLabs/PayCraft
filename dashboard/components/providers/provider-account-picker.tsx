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
  provider: string
  /**
   * The connection this app is pinned to, or null when it follows the default.
   *
   * All three resolution props are OPTIONAL: a server component that already resolved can pass
   * them and save a round trip, and a client component can omit them and let the picker ask. The
   * Stripe and Razorpay pages are client components, so without the self-fetching path the picker
   * could not appear on them at all without refactoring 1,000+ line files.
   */
  attachedId?: string | null
  /** What the app resolves to right now, default included — so the UI states the effect, not the setting. */
  resolvedLabel?: string | null
  resolvedViaDefault?: boolean
}

export function ProviderAccountPicker({
  provider,
  attachedId,
  resolvedLabel,
  resolvedViaDefault,
}: Props) {
  const serverResolved = resolvedLabel !== undefined
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [resolved, setResolved] = useState<
    { label: string | null; viaDefault: boolean; source?: string } | null
  >(serverResolved ? { label: resolvedLabel ?? null, viaDefault: !!resolvedViaDefault } : null)
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

  // Only when the host page did not already resolve — a server component passing props must not
  // trigger a second, slower answer that could briefly contradict what it rendered.
  useEffect(() => {
    if (serverResolved) return
    let cancelled = false
    fetch(`/api/provider-accounts/resolve?provider=${provider}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        const rr = j?.resolved ?? {}
        setResolved({ label: rr.label ?? null, viaDefault: !!rr.via_default, source: rr.source })
        setSelected(rr.via_default ? "" : (rr.account_id ?? ""))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [provider, serverResolved])

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
    <section className="bg-white border border-ink-200 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Billing account</h3>
        <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">
          {resolved === null
            ? // Do not assert absence while the answer is still in flight. Rendering "no credential
              // yet" during the fetch tells an operator their live integration is unconfigured, and
              // it is the state the page spends its first few hundred milliseconds in.
              "Checking which account this app bills through…"
            : resolved.source === "app"
            ? // Its own key, not an account connection. Saying "no credential yet" here — which is
              // what this read before `source` existed — contradicted the very page it sits on for
              // every app configured before the account tier, and invited an operator to "fix" a
              // default that has no bearing on this app.
              "This app uses its own credentials. Pick a connection below to move it onto a shared account."
            : resolved.label
              ? resolved.viaDefault
                ? `This app follows the account default — ${resolved.label}.`
                : `This app bills through ${resolved.label}.`
              : "This app has no credential for this provider yet."}
        </p>
      </div>

      <label className="block text-[11px] font-bold uppercase tracking-tighter text-ink-500">
        Use connection
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => apply(e.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-200 p-2 text-sm text-ink-900 disabled:opacity-50"
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
        <ul className="space-y-1 text-[11px] text-ink-600">
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
                  className="rounded border border-ink-200 px-2 py-0.5 font-bold hover:bg-ink-50 disabled:opacity-50"
                >
                  Make default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p role="status" className="text-[11px] text-emerald-700">{note}</p>}
      {error && <p role="alert" className="text-[11px] text-red-700">{error}</p>}
    </section>
  )
}
