import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { AlertPreferences } from "./alert-prefs"
import { ProviderConfig } from "./provider-config"

export default async function SettingsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: providers } = await supabase
    .from("tenant_providers")
    .select("id, tenant_id, provider, test_payment_links, live_payment_links, is_active, created_at")
    .eq("tenant_id", tenant.id)

  const { data: alertPrefs } = await supabase
    .from("tenant_alert_prefs")
    .select("welcome, limit_warn, limit_hit, webhook_fail, sub_expiry")
    .eq("tenant_id", tenant.id)
    .single()

  const webhookBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stripe-webhook/${tenant.id}`
    : `https://your-project.supabase.co/functions/v1/stripe-webhook/${tenant.id}`

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* API Keys */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">API Keys</h2>
        <p className="text-sm text-gray-500 mb-4">Use these keys in your app&apos;s PayCraft.configure() call.</p>
        <div className="space-y-3">
          <KeyRow label="Test Key" value={tenant.api_key_test} />
          <KeyRow label="Live Key" value={tenant.api_key_live} />
        </div>
      </section>

      {/* Webhook URL */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Webhook URL</h2>
        <p className="text-sm text-gray-500 mb-4">
          Add this URL in your Stripe Dashboard &rarr; Webhooks &rarr; Add endpoint.
        </p>
        <div className="bg-gray-50 rounded-lg p-3 font-mono text-sm break-all">
          {webhookBaseUrl}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Events to listen for: checkout.session.completed, customer.subscription.updated,
          customer.subscription.deleted, invoice.paid
        </p>
      </section>

      {/* Tenant Info */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">App Name</p>
            <p className="text-sm font-medium">{tenant.name}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Plan</p>
            <p className="text-sm font-medium capitalize">{tenant.plan}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Subscriber Limit</p>
            <p className="text-sm font-medium">{tenant.subscriber_limit.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <p className="text-sm font-medium capitalize">{tenant.status}</p>
          </div>
        </div>
      </section>

      {/* Email Notifications */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Email Notifications</h2>
        <p className="text-sm text-gray-500 mb-4">Choose which alerts you receive via email.</p>
        <AlertPreferences tenantId={tenant.id} initial={alertPrefs} />
      </section>

      {/* Provider Configuration */}
      <ProviderConfig providers={providers ?? []} tenantId={tenant.id} />
    </div>
  )
}

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="font-mono text-sm">{value}</p>
      </div>
    </div>
  )
}
