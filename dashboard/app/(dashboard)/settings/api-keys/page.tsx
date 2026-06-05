import { ApiKeysClient } from "@/components/settings/api-keys-client"
import { requireTenant } from "@/lib/tenant"

export default async function ApiKeysPage() {
  const { tenant } = await requireTenant()
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">API keys</h1>
      <p className="text-sm text-gray-500 mb-6">
        Use these keys in your SDK: <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">PayCraft.initialize(apiKey = "pk_live_…")</code>
      </p>
      <ApiKeysClient
        test={tenant.api_key_test}
        live={tenant.api_key_live}
      />
    </div>
  )
}
