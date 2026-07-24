import Link from "next/link"
import { ArrowLeft, Info, Key, ShieldCheck } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { AppStoreKeysForm } from "@/components/providers/app-store-keys-form"

/**
 * App Store Connect store setup page.
 *
 * Captures a tenant's App Store Connect API key (.p8 + key id / issuer id /
 * bundle id) so the dashboard can AUTO-CREATE / SYNC subscription products on
 * the App Store via the ASC `subscriptions` API. The .p8 blob is encrypted at
 * rest in tenant_providers (provider='app_store'); the page only ever reads back
 * the non-secret ids + a connected flag via `tenant_providers_store_status`
 * (the .p8 is never returned to the browser).
 */
export default async function AppStoreSetupPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", {
      p_tenant_id: tenant.id,
      p_provider: "app_store",
    })
    .single<{ connected: boolean; config: Record<string, any> }>()

  const connected = !!status?.connected
  const cfg = status?.config ?? {}

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/providers"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to providers
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink-900">App Store</h1>
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">
            iOS native billing
          </span>
        </div>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          Connect an App Store Connect API key so PayCraft can auto-create and
          keep your subscription products in sync on the App Store (via the ASC{" "}
          <code className="bg-ink-100 px-1 rounded font-mono">subscriptions</code>{" "}
          API). Generate a team key with the <strong>App Manager</strong> role
          under{" "}
          <a
            href="https://appstoreconnect.apple.com/access/integrations/api"
            target="_blank"
            rel="noreferrer"
            className="underline font-bold"
          >
            App Store Connect → Users and Access → Integrations
          </a>
          , then paste the .p8 plus its Key ID, Issuer ID, and your app's Bundle
          ID below.
        </p>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3">
        <CapabilityCard
          icon={<Key className="w-4 h-4 text-brand-600" />}
          title="Auto-create subscriptions"
          body="Each PayCraft subscription is created under a shared subscription group with its own product id, so upgrades/downgrades work natively."
        />
        <CapabilityCard
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}
          title="Encrypted at rest"
          body="Your .p8 key is encrypted with pgcrypto and only ever decrypted server-side to mint a short-lived App Store Connect API token."
        />
        <CapabilityCard
          icon={<Info className="w-4 h-4 text-ink-600" />}
          title="Idempotent sync"
          body="Re-syncing a product targets the same App Store product id — no duplicates. Price is set from the closest Apple price point to your base price."
        />
      </div>

      <AppStoreKeysForm
        connected={connected}
        keyId={(cfg.key_id as string | undefined) ?? null}
        issuerId={(cfg.issuer_id as string | undefined) ?? null}
        bundleId={(cfg.bundle_id as string | undefined) ?? null}
      />

      {/* Status */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>
              {connected
                ? "Connected — subscription products now sync to the App Store."
                : "Not connected yet."}
            </strong>
            <p className="mt-1 leading-relaxed">
              Save credentials above → create or re-sync a subscription product
              at{" "}
              <Link href="/products" className="underline font-bold">
                /products
              </Link>{" "}
              and PayCraft pushes it to App Store Connect, writing the resulting
              App Store product id back onto the product.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function CapabilityCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="bg-white border border-ink-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <h3 className="text-xs font-bold text-ink-900">{title}</h3>
      </div>
      <p className="text-[11px] text-ink-600 leading-relaxed">{body}</p>
    </div>
  )
}
