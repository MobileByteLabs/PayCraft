"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

export default function NewAppPage() {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create app")

      // Switch to the new app
      await fetch("/api/apps/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: data.tenant_id }),
      })
      router.push(`/apps/${data.tenant_id}`)
      router.refresh()
    } catch (e: any) {
      setError(String(e.message ?? e))
      setCreating(false)
    }
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
          Each app gets its own API key, Stripe connection, products, and pricing.
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
              placeholder="e.g. Real Downloader, Athani..."
              autoFocus
              className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
            <p className="text-xs text-ink-400">
              This name is shown in your dashboard only — not visible to your users.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={create}
            disabled={!name.trim() || creating}
            className="w-full justify-center"
          >
            {creating ? "Creating…" : "Create app"}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
