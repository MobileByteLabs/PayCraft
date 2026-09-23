export const runtime = "edge"

import { Terminal } from "lucide-react"
import { DeveloperApiClient } from "@/components/settings/developer-api-client"
import { requireTenant } from "@/lib/tenant"

export default async function DeveloperApiPage() {
  // Gates the page on a real session before any key metadata is fetched.
  await requireTenant()

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900">Developer API</h2>
        <p className="text-ink-500 mt-1 max-w-2xl">
          Server-to-server access for CI, deploy pipelines and agents — check provider readiness and
          run product sync without a browser session.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 flex gap-3">
        <Terminal className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-900 leading-relaxed">
          <p className="font-semibold mb-0.5">These are not your SDK keys.</p>
          <p>
            The public <code className="font-mono">pk_live_</code> /{" "}
            <code className="font-mono">pk_test_</code> keys your app ships with live under{" "}
            <a href="/settings/api-keys" className="underline font-semibold">
              API keys
            </a>
            . The <code className="font-mono">pcsk_</code> keys here are secrets that can bulk-write
            to live payment providers — keep them server-side.
          </p>
        </div>
      </div>

      <DeveloperApiClient />
    </div>
  )
}
