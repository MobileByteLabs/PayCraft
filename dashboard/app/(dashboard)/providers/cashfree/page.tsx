import Link from "next/link"
import { ArrowLeft, AlertCircle, Info, Key, ShieldCheck } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { CashfreeKeysForm } from "@/components/providers/cashfree-keys-form"

/**
 * Cashfree provider setup page.
 *
 * Cashfree is an India-focused payment service provider — alternate to
 * Razorpay with similar surface (UPI, cards, netbanking) and similar
 * pricing (UPI ~1.4%, cards 1.75-2.5%). Useful as a backup when Razorpay
 * is the primary, or as the primary when the merchant has an existing
 * Cashfree relationship.
 *
 * This page captures Manual API keys (app_id + secret + webhook secret)
 * via tenant_providers, the same path as the Razorpay Manual keys flow.
 * Payment-link auto-creation via Cashfree's REST API is a follow-up; for
 * now saving credentials gets the method into "configurable → connected"
 * state in the dashboard's UI, even if the router still falls through to
 * other methods at runtime.
 */
export default async function CashfreeSetupPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("provider, test_key_id, live_key_id, supported_locales")
    .eq("tenant_id", tenant.id)
    .eq("provider", "cashfree")
    .maybeSingle()

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
          <h1 className="text-2xl font-bold text-ink-900">Cashfree</h1>
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">
            India only
          </span>
        </div>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          Cashfree is an Indian PSP supporting UPI, UPI Autopay, cards,
          netbanking, and wallets. Useful as an alternate to Razorpay (similar
          pricing, similar integration surface) or as a primary if you have
          an existing Cashfree relationship. Find your API keys at{" "}
          <a
            href="https://merchant.cashfree.com/merchants/pg/api-keys"
            target="_blank"
            rel="noreferrer"
            className="underline font-bold"
          >
            merchant.cashfree.com → API Keys
          </a>
          .
        </p>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3">
        <CapabilityCard
          icon={<Key className="w-4 h-4 text-brand-600" />}
          title="UPI + UPI Autopay"
          body="Cashfree supports both UPI Collect (one-time) and UPI Autopay (recurring mandate). 1.4% per txn."
        />
        <CapabilityCard
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}
          title="Cards + netbanking"
          body="Indian + international card support, 1.75-2.5% per txn. Netbanking via 50+ banks."
        />
        <CapabilityCard
          icon={<Info className="w-4 h-4 text-ink-600" />}
          title="Settles in INR"
          body="T+1 settlement to your Indian bank account. Then transfer to your home currency via Wise / Payoneer at ~0.5% FX."
        />
      </div>

      <CashfreeKeysForm
        tenantId={tenant.id}
        connected={!!existing}
        testKeyId={existing?.test_key_id ?? null}
        liveKeyId={existing?.live_key_id ?? null}
      />

      {/* Webhook config — point Cashfree at PayCraft */}
      {existing && (
        <div className="bg-white border border-ink-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-ink-900">Webhook URL</h3>
          <p className="text-xs text-ink-500 leading-relaxed">
            In Cashfree Dashboard → Developers → Webhooks, register this URL.
            Subscribe to{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">PAYMENT_SUCCESS_WEBHOOK</code>{" "}
            (and{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">PAYMENT_FAILED_WEBHOOK</code>{" "}
            for visibility). Paste the same webhook secret you set in Cashfree
            into the form above.
          </p>
          <code className="block bg-ink-50 border border-ink-200 px-3 py-2 rounded font-mono text-[11px] text-ink-800 break-all">
            {`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321"}/functions/v1/cashfree-webhook/${tenant.id}`}
          </code>
        </div>
      )}

      {/* Status of integration */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>One-time payments now fully wired.</strong>
            <p className="mt-1 leading-relaxed">
              Save keys above → register the webhook URL in Cashfree's
              dashboard → re-sync any product at <Link href="/products" className="underline font-bold">/products</Link> to push Payment Links to Cashfree.
              For subscriptions (UPI Autopay) use Razorpay or Stripe — Cashfree
              subscription handling is the next phase.
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
