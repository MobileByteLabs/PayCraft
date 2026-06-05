import { AlertCircle, Info, KeyRound } from "lucide-react"
import { ApiKeysClient } from "@/components/settings/api-keys-client"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"

export default async function ApiKeysPage() {
  const { tenant } = await requireTenant()
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="API keys"
        subtitle={
          <>
            Use these keys in your SDK:{" "}
            <code className="code-inline">
              PayCraft.initialize(apiKey = "pk_live_…")
            </code>{" "}
            — they identify your tenant and route SDK config fetches.
          </>
        }
      />

      {/* Security callout */}
      <div className="rounded-xl bg-info-50 border border-info-200 px-4 py-3 mb-6 flex items-start gap-3 animate-fade-in">
        <div className="w-8 h-8 rounded-md bg-info-100 text-info-700 flex items-center justify-center flex-shrink-0">
          <Info className="w-4 h-4" strokeWidth={2} />
        </div>
        <div>
          <div className="text-sm font-semibold text-info-700">
            Treat live keys like passwords
          </div>
          <p className="text-xs text-info-600 mt-1 leading-relaxed">
            Anyone with your <code className="bg-info-100/60 px-1 py-0.5 rounded font-mono text-2xs">pk_live_…</code>{" "}
            key can fetch your paywall config and route checkout to your
            providers. Rotate immediately if exposed.
          </p>
        </div>
      </div>

      <ApiKeysClient test={tenant.api_key_test} live={tenant.api_key_live} />

      {/* Webhook signing secrets */}
      <div className="mt-10">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-ink-500" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-ink-900 uppercase tracking-wider">
            Webhook signing secrets
          </h2>
        </div>
        <p className="text-xs text-ink-500 mb-4">
          Used by your providers to sign incoming webhooks. Configure these in
          the Stripe / Razorpay / etc. dashboards alongside your webhook URL.
        </p>
        <div className="space-y-3">
          <WebhookSecretRow label="Test" value="whsec_test_••••••••••••••" />
          <WebhookSecretRow label="Live" value="whsec_live_••••••••••••••" />
        </div>
      </div>
    </div>
  )
}

function WebhookSecretRow({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="!py-3 flex items-center gap-3">
        <div className="w-16 text-xs font-bold text-ink-500 uppercase tracking-wider">
          {label}
        </div>
        <code className="flex-1 text-xs font-mono text-ink-700 bg-ink-50 border border-ink-200 px-3 py-1.5 rounded">
          {value}
        </code>
      </CardBody>
    </Card>
  )
}
