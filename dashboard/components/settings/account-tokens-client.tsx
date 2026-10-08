"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, Plus, ShieldAlert, Trash2, Check, Copy, Boxes } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

/**
 * ACCOUNT-scoped access tokens (`pcsk_`, migration 150).
 *
 * The sibling of DeveloperApiClient, deliberately separate: that screen mints a token for ONE app,
 * this one mints a token reaching EVERY app you administer. Same credential prefix, very different
 * blast radius, so the two are never listed together — the mistake to design against is granting
 * account reach while believing you granted app reach.
 */

interface TokenRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

interface Reach {
  id: string
  name: string | null
}

/**
 * Grouped the way Supabase groups token permissions, and for the same reason: a flat list of
 * sixteen checkboxes gets approved wholesale, whereas a reader who has to open "Write" to find
 * `keys:rotate` has been told what they are granting.
 *
 * Nothing is pre-selected. A token minted with an assumed permission is one nobody chose to grant,
 * and at account scope that assumption spans every app.
 */
const GROUPS: { title: string; detail: string; write?: boolean; scopes: { id: string; detail: string }[] }[] = [
  {
    title: "Read",
    detail: "Inspect configuration and state. Cannot change anything.",
    scopes: [
      { id: "apps:read", detail: "List the apps this token reaches" },
      { id: "readiness:read", detail: "Per-provider, per-mode readiness" },
      { id: "tenant:read", detail: "Plan, limits and this token's own scopes" },
      { id: "products:read", detail: "Product catalogue and the drift report" },
      { id: "providers:read", detail: "Provider connections (never credentials)" },
      { id: "paywall:read", detail: "Paywall configuration" },
      { id: "subscribers:read", detail: "Subscriber records" },
      { id: "coupons:read", detail: "Coupon definitions" },
      { id: "audit:read", detail: "Audit log" },
      { id: "webhooks:read", detail: "Webhook registrations and health" },
    ],
  },
  {
    title: "Write",
    detail: "Changes configuration, and in some cases live payment providers.",
    write: true,
    scopes: [
      { id: "products:sync", detail: "Run the sync drain — bulk-writes to LIVE providers" },
      { id: "products:write", detail: "Create and edit products" },
      { id: "paywall:write", detail: "Edit paywall configuration" },
      { id: "providers:write", detail: "Edit provider connections" },
    ],
  },
  {
    title: "Account",
    detail: "Spans apps. Grant only to tooling that provisions or rotates.",
    write: true,
    scopes: [
      { id: "apps:provision", detail: "Create new apps on this account" },
      { id: "keys:rotate", detail: "Rotate an app's publishable key — invalidates released builds" },
    ],
  },
]

const EXPIRY_CHOICES = [
  { days: 7, label: "7 days", recommended: true },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
]

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"

/** Days until expiry, negative once past. Drives the "expires soon" hint. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function AccountTokensClient() {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [reaches, setReaches] = useState<Reach[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)

  // The plaintext token, held in memory only and shown once — the server keeps a hash, so this is
  // the single moment it can be copied.
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/account-tokens")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "could not load tokens")
      setTokens(data.tokens ?? [])
      setReaches(data.reaches ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function create() {
    setBusy(true)
    try {
      const res = await fetch("/api/account-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes: selected, expires_in_days: days }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "could not create token")
      setFreshToken(data.api_key)
      setCreating(false)
      setName("")
      setSelected([])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string, label: string) {
    if (!confirm(`Revoke "${label}"? Anything using it stops working immediately.`)) return
    try {
      const res = await fetch(`/api/account-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json())?.error ?? "could not revoke")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const writeSelected = selected.some((s) =>
    GROUPS.filter((g) => g.write).some((g) => g.scopes.some((x) => x.id === s)),
  )

  return (
    <div className="space-y-6">
      {/* Shown ONCE. Deliberately not dismissible by clicking away — losing it means minting another. */}
      {freshToken && (
        <Card className="border-emerald-300 bg-emerald-50/60">
          <CardBody className="space-y-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-900">
                <p className="font-semibold">Copy this now — it is shown once.</p>
                <p className="text-xs mt-0.5">
                  It reaches every app you administer. Store it like a password; if you lose it,
                  revoke it and create another.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 break-all">
                {freshToken}
              </code>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(freshToken)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <button
              className="text-xs text-emerald-800 underline"
              onClick={() => setFreshToken(null)}
            >
              I have saved it
            </button>
          </CardBody>
        </Card>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* What a token minted here would reach, stated before anyone mints one. */}
      <Card>
        <CardHeader
          title={
            <span className="font-semibold text-sm flex items-center gap-2">
              <Boxes className="w-4 h-4 text-ink-500" />
              Tokens here reach {reaches.length} app{reaches.length === 1 ? "" : "s"}
            </span>
          }
        />
        <CardBody>
          {reaches.length === 0 ? (
            <p className="text-sm text-ink-500">
              You do not administer any apps yet, so there is nothing a token could reach.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {reaches.map((r) => (
                  <span
                    key={r.id}
                    className="text-xs font-mono bg-ink-50 border border-ink-200 rounded-md px-2 py-1"
                  >
                    {r.name ?? r.id}
                  </span>
                ))}
              </div>
              <p className="text-xs text-ink-500 mt-3">
                Reach is not fixed at creation — it is recomputed on every request, so removing
                yourself from an app removes this token&apos;s access to it immediately.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="font-semibold text-sm flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-ink-500" />
              Access tokens
            </span>
          }
          action={
            !creating ? (
              <Button onClick={() => setCreating(true)} disabled={reaches.length === 0}>
                <Plus className="w-4 h-4" /> Generate token
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {creating && (
            <div className="mb-6 space-y-4 border-b border-ink-100 pb-6">
              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">Name</label>
                <input
                  className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. claude-onboarding"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">Expires in</label>
                <div className="flex flex-wrap gap-2">
                  {EXPIRY_CHOICES.map((c) => (
                    <button
                      key={c.days}
                      onClick={() => setDays(c.days)}
                      className={`text-xs rounded-lg border px-3 py-1.5 ${
                        days === c.days
                          ? "border-indigo-400 bg-indigo-50 text-indigo-900 font-semibold"
                          : "border-ink-200 text-ink-600"
                      }`}
                    >
                      {c.label}
                      {c.recommended && <span className="ml-1 text-[10px] opacity-70">recommended</span>}
                    </button>
                  ))}
                </div>
                {/* Expiry is mandatory — the database refuses an account token without one. */}
                <p className="text-xs text-ink-500 mt-1.5">
                  Account tokens must expire. A shorter life is cheaper to replace than to regret.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-2">
                  Permissions — nothing is granted by default
                </label>
                <div className="space-y-4">
                  {GROUPS.map((g) => (
                    <div key={g.title}>
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-ink-800">{g.title}</span>
                        {g.write && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            changes data
                          </span>
                        )}
                        <span className="text-xs text-ink-500">{g.detail}</span>
                      </div>
                      <div className="space-y-1">
                        {g.scopes.map((s) => (
                          <label key={s.id} className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={selected.includes(s.id)}
                              onChange={() => toggle(s.id)}
                            />
                            <span>
                              <code className="font-mono text-ink-800">{s.id}</code>
                              <span className="text-ink-500"> — {s.detail}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {writeSelected && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  This token can change data in <strong>every</strong> app you administer, not just
                  one. Grant write scopes only to tooling you would trust with all of them.
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={create} disabled={busy || !name.trim() || selected.length === 0}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Generate
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
              {selected.length === 0 && (
                <p className="text-xs text-ink-500">Select at least one permission.</p>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-ink-500">
              No account tokens yet. Generate one to let CI or an agent work across your apps.
            </p>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => {
                const left = daysUntil(t.expires_at)
                return (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-4 border border-ink-100 rounded-lg px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink-900">{t.name}</span>
                        <code className="text-xs font-mono text-ink-500">{t.key_prefix}…</code>
                        {left !== null && left <= 7 && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            {left <= 0 ? "expired" : `expires in ${left}d`}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.scopes.map((s) => (
                          <code
                            key={s}
                            className="text-[10px] font-mono bg-ink-50 border border-ink-200 rounded px-1.5 py-0.5"
                          >
                            {s}
                          </code>
                        ))}
                      </div>
                      <p className="text-xs text-ink-500 mt-1.5">
                        Created {fmt(t.created_at)} · Last used {fmt(t.last_used_at)} · Expires{" "}
                        {fmt(t.expires_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => revoke(t.id, t.name)}
                      className="text-ink-400 hover:text-rose-600 shrink-0"
                      aria-label={`Revoke ${t.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
