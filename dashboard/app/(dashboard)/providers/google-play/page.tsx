import Link from "next/link"
import { ArrowLeft, Info, Key, ShieldCheck } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { GooglePlayKeysForm } from "@/components/providers/google-play-keys-form"

/**
 * Google Play store setup page.
 *
 * Captures a tenant's Play Developer API service-account credentials so the
 * dashboard can AUTO-CREATE / SYNC subscription products on Google Play via the
 * androidpublisher `monetization.subscriptions` API. The credential blob is
 * encrypted at rest in tenant_providers (provider='google_play'); the page only
 * ever reads back the non-secret package name + a connected flag via
 * `tenant_providers_store_status` (the SA JSON is never returned to the browser).
 */
export default async function GooglePlaySetupPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", {
      p_tenant_id: tenant.id,
      p_provider: "google_play",
    })
    .single<{ connected: boolean; config: Record<string, any> }>()

  const connected = !!status?.connected
  const packageName = (status?.config?.package_name as string | undefined) ?? null

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
          <h1 className="text-2xl font-bold text-ink-900">Google Play</h1>
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">
            Android native billing
          </span>
        </div>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          Connect a Google Play Developer API service account so PayCraft can
          auto-create and keep your subscription products in sync on Google Play
          (via the androidpublisher{" "}
          <code className="bg-ink-100 px-1 rounded font-mono">monetization.subscriptions</code>{" "}
          API). Create a service account with the{" "}
          <strong>“Financial data, orders”</strong> + <strong>“Manage products”</strong>{" "}
          permissions in{" "}
          <a
            href="https://play.google.com/console/developers/users-and-permissions"
            target="_blank"
            rel="noreferrer"
            className="underline font-bold"
          >
            Play Console → Users and permissions
          </a>
          , download its JSON key, and paste it below.
        </p>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3">
        <CapabilityCard
          icon={<Key className="w-4 h-4 text-brand-600" />}
          title="Auto-create subscriptions"
          body="Each PayCraft subscription product is created on Play as a subscription + auto-renewing base plan, keyed by a stable product id."
        />
        <CapabilityCard
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}
          title="Encrypted at rest"
          body="Your service-account JSON is encrypted with pgcrypto and only ever decrypted server-side to mint a short-lived androidpublisher token."
        />
        <CapabilityCard
          icon={<Info className="w-4 h-4 text-ink-600" />}
          title="Idempotent sync"
          body="Re-syncing a product targets the same Play product id — no duplicates. Prices on an active base plan are immutable, matching Play's own rules."
        />
      </div>

      <GooglePlayKeysForm connected={connected} packageName={packageName} />

      {/* Status */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>
              {connected
                ? "Connected — subscription products now sync to Google Play."
                : "Not connected yet."}
            </strong>
            <p className="mt-1 leading-relaxed">
              Save credentials above → create or re-sync a subscription product
              at{" "}
              <Link href="/products" className="underline font-bold">
                /products
              </Link>{" "}
              and PayCraft pushes it to Google Play, writing the resulting Play
              product id back onto the product.
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
