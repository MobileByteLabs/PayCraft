import { Info } from "lucide-react"
import { ApiKeysClient } from "@/components/settings/api-keys-client"
import { requireTenant } from "@/lib/tenant"

export default async function ApiKeysPage() {
  const { tenant } = await requireTenant()

  return (
    <div className="max-w-[768px] mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900">
          API keys
        </h2>
        <p className="text-ink-500 mt-1 max-w-2xl">
          Use these keys in your SDK:{" "}
          <code className="bg-ink-100 px-1.5 py-0.5 rounded text-ink-800 font-mono text-xs">
            PayCraft.initialize(apiKey = &quot;pk_live_...&quot;)
          </code>{" "}
          — they identify your tenant and route SDK config fetches.
        </p>
      </div>

      <div className="space-y-6">
        {/* Security callout */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-4">
          <div className="text-blue-500 mt-0.5 flex-shrink-0">
            <Info className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-blue-900">
              Treat live keys like passwords
            </h4>
            <p className="text-sm text-blue-800/80 mt-1">
              Anyone with your{" "}
              <code className="font-mono text-xs font-bold">pk_live_...</code>{" "}
              key can fetch your paywall config and route checkout to your
              providers. Rotate immediately if exposed.
            </p>
          </div>
        </div>

        {/* API Key Cards */}
        <ApiKeysClient test={tenant.api_key_test} live={tenant.api_key_live} />

        {/* Webhook signing secrets */}
        <div className="pt-8 mt-4 border-t border-ink-200">
          <h5 className="text-[11px] font-bold text-ink-400 uppercase tracking-wider mb-1">
            Webhook signing secrets
          </h5>
          <p className="text-sm text-ink-500 mb-6">
            Used by your providers to sign incoming webhooks. Configure these in
            Stripe/Razorpay/etc. dashboards.
          </p>
          <div className="space-y-3">
            <WebhookSecretRow
              label="Test"
              value="whsec_test_••••••••••••••••••••••••••••••••"
            />
            <WebhookSecretRow
              label="Live"
              value="whsec_live_••••••••••••••••••••••••••••••••"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function WebhookSecretRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white border border-ink-200 rounded-lg shadow-sm">
      <div className="flex items-center gap-4">
        <span className="text-sm font-bold text-ink-800 w-12">{label}</span>
        <code className="font-mono text-xs text-ink-400">{value}</code>
      </div>
    </div>
  )
}
