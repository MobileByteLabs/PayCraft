"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, Plus, ShieldAlert, Trash2, Check, Copy, ExternalLink } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface KeyRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

const SCOPES: { id: string; label: string; detail: string; write?: boolean }[] = [
  { id: "readiness:read", label: "readiness:read", detail: "Read per-provider, per-mode readiness" },
  { id: "providers:read", label: "providers:read", detail: "Read provider connection detail" },
  { id: "products:read", label: "products:read", detail: "Read the drift report" },
  {
    id: "products:sync",
    label: "products:sync",
    detail: "Run the sync drain — bulk-writes to LIVE payment providers",
    write: true,
  },
]

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"

export function DeveloperApiClient() {
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<string[]>(["readiness:read"])
  const [busy, setBusy] = useState(false)

  // The plaintext key, held in memory only and shown once. It is never fetched back, because the
  // server stores only a hash — so this is the single moment it can be copied.
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/developer-keys")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "could not load keys")
      setKeys(data.keys ?? [])
      setError(null)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/developer-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes: selected }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "could not create key")
      setFreshKey(data.api_key)
      setName("")
      setSelected(["readiness:read"])
      setCreating(false)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(k: KeyRow) {
    // Revocation is immediate and permanent — the row stays for the audit trail, the key stops
    // authenticating. Worth a confirm: anything still using it breaks the moment this returns.
    if (!confirm(`Revoke "${k.name}"? Anything still using this key stops working immediately.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/developer-keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "could not revoke")
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const active = keys.filter((k) => !k.revoked_at)
  const revoked = keys.filter((k) => k.revoked_at)

  return (
    <div className="space-y-6">
      {/* ── the one-time reveal ─────────────────────────────────────────────────────────────── */}
      {freshKey && (
        <Card className="border-emerald-300">
          <CardHeader
            title={
              <span className="font-semibold text-emerald-900 flex items-center gap-2">
                <Check className="w-4 h-4" /> Key created — copy it now
              </span>
            }
          />
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-600">
              This is the only time the key is shown. PayCraft stores a hash, not the key, so it
              cannot be recovered — if you lose it, revoke this one and create another.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-ink-900 text-ink-50 px-3 py-2.5 rounded-lg break-all">
                {freshKey}
              </code>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(freshKey)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="text-xs text-ink-500 space-y-1">
              <p className="font-semibold text-ink-700">Store it in a secret manager, then try it:</p>
              <pre className="bg-ink-50 border border-ink-200 rounded-lg p-3 overflow-x-auto font-mono text-[11px] leading-relaxed">
{`curl -H "Authorization: Bearer $PAYCRAFT_KEY" \\
  https://api.paycraft.mobilebytesensei.com/v1/readiness`}
              </pre>
            </div>
            <Button variant="ghost" onClick={() => setFreshKey(null)}>
              Done — I have saved it
            </Button>
          </CardBody>
        </Card>
      )}

      {error && (
        <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* ── create ─────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Secret keys"
          subtitle={
            <>
              Server-side only. Never ship a <code className="font-mono">pcsk_</code> key in an app
              bundle — that is what the public <code className="font-mono">pk_</code> keys are for.
            </>
          }
          action={
            !creating ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="w-4 h-4" /> New key
              </Button>
            ) : undefined
          }
        />

        {creating && (
          <CardBody className="space-y-4 border-b border-ink-100">
            <div>
              <label className="block text-xs font-semibold text-ink-700 mb-1.5">
                What is it for?
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ci-release-pipeline"
                className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <p className="text-[11px] text-ink-400 mt-1">
                Shown in the audit log next to everything this key does.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-700 mb-1.5">Scopes</label>
              <div className="space-y-1.5">
                {SCOPES.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-ink-200 hover:bg-ink-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-semibold text-ink-800">{s.label}</span>
                      {s.write && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          writes live
                        </span>
                      )}
                      <span className="block text-[11px] text-ink-500 mt-0.5">{s.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-ink-400 mt-1.5">
                Grant only what the caller needs. A read key cannot bulk-write to live providers even
                though both use the same authentication.
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={create} disabled={busy || !name.trim() || !selected.length}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Create key
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </CardBody>
        )}

        <CardBody>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading keys…
            </div>
          ) : active.length === 0 ? (
            <div className="text-center py-8">
              <KeyRound className="w-8 h-8 text-ink-300 mx-auto mb-2" />
              <p className="text-sm text-ink-500">No secret keys yet.</p>
              <p className="text-xs text-ink-400 mt-1">
                Create one to automate readiness checks and product sync from CI.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {active.map((k) => (
                <div
                  key={k.id}
                  className="flex items-start justify-between gap-4 px-3 py-2.5 rounded-lg border border-ink-200"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-900">{k.name}</span>
                      <code className="font-mono text-[11px] text-ink-500 bg-ink-100 px-1.5 py-0.5 rounded">
                        {k.key_prefix}
                      </code>
                    </div>
                    <div className="flex gap-1 flex-wrap mt-1.5">
                      {k.scopes.map((s) => (
                        <span
                          key={s}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            s === "products:sync"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-ink-100 text-ink-600"
                          }`}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-ink-400 mt-1.5">
                      Created {fmt(k.created_at)} · Last used{" "}
                      {k.last_used_at ? fmt(k.last_used_at) : "never"}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(k)}
                    disabled={busy}
                    className="text-ink-400 hover:text-danger-600 p-1.5 rounded disabled:opacity-40"
                    title="Revoke"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {revoked.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-700">
                {revoked.length} revoked key{revoked.length === 1 ? "" : "s"}
              </summary>
              {/* Kept, not deleted: the audit log references these ids, and a revoked key that
                  vanishes takes the history of what it did with it. */}
              <div className="space-y-1.5 mt-2">
                {revoked.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ink-50 text-ink-400"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs line-through">{k.name}</span>
                    <code className="font-mono text-[10px]">{k.key_prefix}</code>
                    <span className="text-[11px] ml-auto">revoked {fmt(k.revoked_at)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardBody>
      </Card>

      {/* ── reference ──────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Reference" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <a
              href="https://api.paycraft.mobilebytesensei.com/v1/docs"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline"
            >
              Interactive API reference <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="text-ink-300">·</span>
            <a
              href="https://api.paycraft.mobilebytesensei.com/v1/openapi.json"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline"
            >
              openapi.json <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="text-xs text-ink-600 space-y-2">
            <p className="font-semibold text-ink-800">Endpoints</p>
            <table className="w-full text-[11px] font-mono">
              <tbody className="divide-y divide-ink-100">
                {[
                  ["GET", "/v1/readiness", "readiness:read"],
                  ["GET", "/v1/sync", "products:read"],
                  ["POST", "/v1/sync", "products:sync"],
                ].map(([m, p, s]) => (
                  <tr key={m + p}>
                    <td className="py-1.5 pr-3 font-bold text-ink-700 w-12">{m}</td>
                    <td className="py-1.5 pr-3 text-ink-800">{p}</td>
                    <td className="py-1.5 text-ink-500">{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-ink-500 pt-1">
              The tenant comes from the key — no endpoint accepts a tenant id. Rate limit: 120
              requests, refilling at 1/second.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
