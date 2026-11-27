"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { ArrowLeft, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

type ProviderInfo = { provider: string; account: string | null }
type AppRow = { id: string; name: string; providers?: ProviderInfo[]; owner_email?: string }

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  google_play: "Google Play",
  app_store: "App Store",
}

export default function NewAppPage() {
  const [name, setName] = useState("")
  const queryClient = useQueryClient()
  // The reuse picker needs each app's connected providers, which /api/apps already returns.
  const appsQuery = useQuery({
    queryKey: ["apps", "with-providers"],
    queryFn: async () => {
      const res = await fetch("/api/apps", { cache: "no-store" })
      if (!res.ok) throw new Error(`Couldn't load your apps (${res.status})`)
      const data = await res.json()
      return (Array.isArray(data) ? data : data.apps ?? []) as AppRow[]
    },
  })
  const apps = appsQuery.data ?? []
  // Provider setup choice. Default to reusing the account's existing connections
  // when the account already has another app — one provider secret serves many apps.
  const [providerMode, setProviderMode] = useState<"reuse" | "later">("later")
  const [reuseFrom, setReuseFrom] = useState<string>("")
  // Which of the source app's providers to copy — all checked by default.
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set())
  const router = useRouter()

  // Whenever the source app changes, select ALL of its providers by default.
  useEffect(() => {
    const src = apps.find((a) => a.id === reuseFrom)
    setSelectedProviders(new Set((src?.providers ?? []).map((p) => p.provider)))
  }, [reuseFrom, apps])

  // Once the list arrives, default to reusing the account's existing connections.
  const [defaulted, setDefaulted] = useState(false)
  useEffect(() => {
    if (defaulted || !appsQuery.data) return
    setDefaulted(true)
    if (appsQuery.data.length > 0) {
      setProviderMode("reuse")
      setReuseFrom(appsQuery.data[0].id)
    }
  }, [appsQuery.data, defaulted])

  const createMutation = useMutation({
    mutationFn: async () => {
      let tenantId: string
      if (providerMode === "reuse" && reuseFrom) {
        // Full onboarding: create the tenant, INHERIT the source app's connected
        // providers (same secret, many apps), and seed default products. Sync is
        // left to the product page's live dialog (keeps this request cap-safe).
        const res = await fetch("/api/onboarding/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            app_name: name.trim(),
            inherit_providers_from: reuseFrom,
            inherit_providers: Array.from(selectedProviders),
            seed_products: true,
            sync: false,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to create app")
        tenantId = data.tenant_id
      } else {
        // Create only — the user will connect providers later.
        const res = await fetch("/api/apps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to create app")
        tenantId = data.tenant_id
      }

      await fetch("/api/apps/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      })
      return tenantId
    },
    onSuccess: async (tenantId) => {
      await queryClient.invalidateQueries({ queryKey: ["apps"] })
      router.push(`/apps/${tenantId}`)
      // The active app changed: the (server) layout must re-resolve it, so this refresh stays.
      router.refresh()
    },
  })
  const creating = createMutation.isPending || createMutation.isSuccess
  const error = createMutation.error?.message ?? null

  function create() {
    if (!name.trim() || creating) return
    createMutation.mutate()
  }

  return (
    <div className="max-w-lg mx-auto pt-16">
      <Link
        href="/apps"
        className="flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to apps
      </Link>

      <div className="mb-8">
        <div className="w-12 h-12 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
          <Smartphone className="w-6 h-6 text-brand-600" />
        </div>
        <h1 className="text-2xl font-extrabold text-ink-900">Register a new app</h1>
        <p className="text-ink-500 text-sm mt-1">
          Each app gets its own API key. Providers can be shared across your apps —
          connect once, reuse everywhere.
        </p>
      </div>

      <Card>
        <CardBody className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
              App name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Reels Downloader, Athani..."
              autoFocus
              className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
            <p className="text-xs text-ink-400">
              This name is shown in your dashboard only — not visible to your users.
            </p>
          </div>

          {/* #1 — Providers: reuse the account's existing connections or add later. */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
              Payment providers
            </label>
            {appsQuery.isPending && (
              <p role="status" aria-busy="true" className="text-xs text-ink-400 animate-pulse">
                Loading your connected providers…
              </p>
            )}
            {appsQuery.isError && (
              <p role="alert" className="text-xs text-danger-700">
                {appsQuery.error.message} — you can still create the app and connect providers later.{" "}
                <button type="button" onClick={() => void appsQuery.refetch()} className="font-semibold underline">
                  Retry
                </button>
              </p>
            )}
            {apps[0]?.owner_email && (
              <p className="text-xs text-ink-400">
                Shared across your apps under <span className="font-medium text-ink-600">{apps[0].owner_email}</span>
              </p>
            )}
            <div className="space-y-2">
              <label
                className={
                  "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors " +
                  (providerMode === "reuse" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300") +
                  (apps.length === 0 ? " opacity-50 pointer-events-none" : "")
                }
              >
                <input
                  type="radio"
                  name="providerMode"
                  className="mt-0.5"
                  checked={providerMode === "reuse"}
                  disabled={apps.length === 0}
                  onChange={() => setProviderMode("reuse")}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink-900">Use my existing connected providers</div>
                  <p className="text-xs text-ink-500 mt-0.5">
                    Reuse Stripe / Razorpay / Google Play / App Store from another app — one secret, many apps.
                  </p>
                  {providerMode === "reuse" && apps.length > 0 && (
                    <>
                      <select
                        value={reuseFrom}
                        onChange={(e) => setReuseFrom(e.target.value)}
                        className="mt-2 w-full px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                      >
                        {apps.map((a) => (
                          <option key={a.id} value={a.id}>
                            Copy providers from “{a.name}”
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const provs = apps.find((a) => a.id === reuseFrom)?.providers ?? []
                        return provs.length > 0 ? (
                          <div className="mt-2 rounded-lg border border-ink-100 bg-white p-1">
                            {provs.map((p) => (
                              <label
                                key={p.provider}
                                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-ink-50"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 shrink-0 accent-brand-600"
                                  checked={selectedProviders.has(p.provider)}
                                  onChange={(e) =>
                                    setSelectedProviders((prev) => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(p.provider)
                                      else next.delete(p.provider)
                                      return next
                                    })
                                  }
                                />
                                <span className="w-24 shrink-0 font-medium text-ink-800">
                                  {PROVIDER_LABELS[p.provider] ?? p.provider}
                                </span>
                                {p.account && (
                                  <span className="truncate font-mono text-[11px] text-ink-400" title={p.account}>
                                    {p.account}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-amber-600">This app has no connected providers yet — pick another or connect later.</p>
                        )
                      })()}
                    </>
                  )}
                </div>
              </label>

              <label
                className={
                  "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors " +
                  (providerMode === "later" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300")
                }
              >
                <input
                  type="radio"
                  name="providerMode"
                  className="mt-0.5"
                  checked={providerMode === "later"}
                  onChange={() => setProviderMode("later")}
                />
                <div>
                  <div className="text-sm font-medium text-ink-900">Connect providers later</div>
                  <p className="text-xs text-ink-500 mt-0.5">Create the app now; connect Stripe and the stores from its settings.</p>
                </div>
              </label>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={create}
            disabled={!name.trim()}
            loading={creating}
            className="w-full justify-center"
          >
            {creating ? "Creating…" : "Create app"}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
