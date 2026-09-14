"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2, Star, Trash2 } from "lucide-react"

/**
 * Account-level provider connections.
 *
 * Grouped by provider because "which is the default" is a per-provider question — one default for
 * Google Play, one for Stripe — and a flat list would make the reader reconstruct that grouping in
 * their head to answer it.
 *
 * `apps_using` is shown on every row rather than on hover or behind a click: it is the number that
 * makes every other action on the row make sense. Renaming is safe at any count; rotating a key is
 * a decision that scales with it; and a delete refusal is only comprehensible if you can already
 * see that six apps depend on the thing you just tried to remove.
 */
interface Connection {
  id: string
  provider: string
  label: string
  is_default: boolean
  has_credential: boolean
  config: Record<string, unknown>
  apps_using: number
  is_mine: boolean
  created_at: string
}

const PROVIDER_NAMES: Record<string, string> = {
  google_play: "Google Play",
  app_store: "App Store Connect",
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  direct_upi: "UPI",
}

/** The non-secret identifier that distinguishes two connections to the same provider. */
function identity(c: Connection): string | null {
  const cfg = c.config ?? {}
  return (
    (cfg.client_email as string) ??
    (cfg.live_key_id as string) ??
    (cfg.test_key_id as string) ??
    (cfg.key_id as string) ??
    null
  )
}

export function ProviderConnectionsManager() {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-accounts/manage")
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`)
      setConnections((json.connections ?? []) as Connection[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConnections([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function mutate(id: string, body: Record<string, unknown>, okNote: string) {
    setBusy(id)
    setError(null)
    setNote(null)
    try {
      const res = await fetch("/api/provider-accounts/manage", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`)
      setNote(okNote)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setEditing(null)
    }
  }

  async function remove(c: Connection) {
    setBusy(c.id)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/provider-accounts/manage?id=${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (res.status === 409 && json?.error === "connection_in_use") {
        // Naming the count turns a refusal into an instruction: the operator knows exactly how much
        // work stands between them and being able to delete this.
        setError(
          `“${c.label}” still bills ${json.appsUsing} app${json.appsUsing === 1 ? "" : "s"}. ` +
            `Point ${json.appsUsing === 1 ? "it" : "them"} at another connection first — deleting now ` +
            `would silently move ${json.appsUsing === 1 ? "that app" : "those apps"} to the account default.`,
        )
        return
      }
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`)
      setNote(`Deleted “${c.label}”.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (connections === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-500 py-8">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading connections…
      </div>
    )
  }

  const byProvider = connections.reduce<Record<string, Connection[]>>((acc, c) => {
    ;(acc[c.provider] ??= []).push(c)
    return acc
  }, {})
  const providers = Object.keys(byProvider).sort()

  return (
    <div className="space-y-5">
      {note && (
        <p role="status" className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {providers.length === 0 && (
        <div className="bg-white border border-ink-200 rounded-xl p-6 text-center">
          <p className="text-sm font-bold text-ink-900">No connections yet</p>
          <p className="text-xs text-ink-500 mt-1 max-w-md mx-auto">
            A connection is created the first time you save provider credentials on any app. It then
            belongs to your account, and every other app can bill through it without pasting the key
            again.
          </p>
        </div>
      )}

      {providers.map((p) => (
        <section key={p} className="bg-white border border-ink-200 rounded-xl overflow-hidden">
          <header className="px-5 py-3 border-b border-ink-100 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-ink-900">{PROVIDER_NAMES[p] ?? p}</h3>
            <span className="text-[11px] text-ink-500">
              {byProvider[p].length} connection{byProvider[p].length === 1 ? "" : "s"}
            </span>
          </header>

          <ul className="divide-y divide-ink-100">
            {byProvider[p].map((c) => (
              <li key={c.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editing === c.id ? (
                      <input
                        autoFocus
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void mutate(c.id, { label: draftLabel }, "Renamed.")
                          if (e.key === "Escape") setEditing(null)
                        }}
                        className="px-2 py-1 border border-ink-300 rounded text-sm"
                      />
                    ) : (
                      <span className="text-sm font-bold text-ink-900 truncate">{c.label}</span>
                    )}
                    {c.is_default && (
                      <span className="text-[10px] font-bold uppercase tracking-tighter bg-brand-50 text-brand-700 border border-brand-200 px-1.5 py-0.5 rounded">
                        Default
                      </span>
                    )}
                    {!c.has_credential && (
                      <span className="text-[10px] font-bold uppercase tracking-tighter bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                        No key
                      </span>
                    )}
                    {!c.is_mine && (
                      <span className="text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                        Teammate&rsquo;s
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-ink-500 mt-0.5 truncate">
                    {identity(c) && <span className="font-mono">{identity(c)}</span>}
                    {identity(c) && " · "}
                    bills {c.apps_using} app{c.apps_using === 1 ? "" : "s"}
                    {c.is_default && c.apps_using === 0 && " · new apps inherit this"}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {busy === c.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-400" />
                  ) : (
                    <>
                      {c.is_mine && editing !== c.id && (
                        <button
                          onClick={() => {
                            setEditing(c.id)
                            setDraftLabel(c.label)
                          }}
                          className="text-[11px] font-bold text-ink-600 border border-ink-200 rounded px-2 py-1 hover:bg-ink-50"
                        >
                          Rename
                        </button>
                      )}
                      {editing === c.id && (
                        <button
                          onClick={() => void mutate(c.id, { label: draftLabel }, "Renamed.")}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-brand-600 rounded px-2 py-1 hover:bg-brand-700"
                        >
                          <Check className="w-3 h-3" />
                          Save
                        </button>
                      )}
                      {!c.is_default && c.is_mine && (
                        <button
                          onClick={() =>
                            void mutate(
                              c.id,
                              { makeDefault: true },
                              // Said plainly because it is not a local change.
                              `“${c.label}” is now the default. Every app following the default uses it.`,
                            )
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-600 border border-ink-200 rounded px-2 py-1 hover:bg-ink-50"
                        >
                          <Star className="w-3 h-3" />
                          Make default
                        </button>
                      )}
                      {c.is_mine && (
                        <button
                          onClick={() => void remove(c)}
                          title={c.apps_using > 0 ? `Used by ${c.apps_using} app(s)` : "Delete"}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
