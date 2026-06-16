import Link from "next/link"
import { ArrowLeft, Smartphone, ShieldCheck, TrendingDown, Info } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { UpiSetupForm } from "@/components/providers/upi-setup-form"

/**
 * UPI Direct integration setup page.
 *
 * Merchants paste their personal or business UPI VPA here; PayCraft uses it
 * to generate `upi://pay?...` deep links for Indian customers buying
 * one-time / lifetime products. Zero fees per transaction (vs Stripe
 * cross-border at ~7.8%). Subscriptions still need Razorpay UPI Autopay —
 * direct UPI doesn't support recurring.
 */
export default async function UpiSetupPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // List endpoint returns the merged registry+tenant view; filter to the
  // direct_upi method's existing config (if any).
  const { data: methods } = await supabase
    .rpc("tenant_payment_methods_list", { p_tenant_id: tenant.id })
  const upiRow = (methods ?? []).find((m: any) => m.method === "direct_upi")

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
          <h1 className="text-2xl font-bold text-ink-900">UPI Direct</h1>
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
            0% fees
          </span>
        </div>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          Customers in India pay you via their UPI app (Google Pay, PhonePe,
          Paytm, BHIM, etc.) — money lands in your bank account directly.
          No payment processor in between, so no card processing fee and no
          FX markup. Works for one-time and lifetime products. For
          subscriptions, route through Razorpay UPI Autopay.
        </p>
      </div>

      {/* Value proposition cards */}
      <div className="grid grid-cols-3 gap-3">
        <ValueCard
          icon={<TrendingDown className="w-4 h-4 text-emerald-600" />}
          title="0% transaction fees"
          body="vs 7.8% cross-border via Stripe for an Indian card paying a Canadian merchant. On ₹1000 you net ₹1000, not CA$13.35 (~₹825)."
        />
        <ValueCard
          icon={<Smartphone className="w-4 h-4 text-brand-600" />}
          title="Customer-friendly"
          body="One tap to open the customer's UPI app with the amount + your VPA pre-filled. No card details, no foreign-currency confusion."
        />
        <ValueCard
          icon={<ShieldCheck className="w-4 h-4 text-ink-600" />}
          title="No PSP, no KYC delays"
          body="Direct A2A transfer to your bank. You don't onboard with Razorpay / Cashfree, don't share encrypted keys with anyone, don't wait for verification."
        />
      </div>

      {/* Configuration form */}
      <UpiSetupForm tenantId={tenant.id} initial={upiRow?.config ?? null} enabled={upiRow?.enabled ?? false} />

      {/* Constraints + how it works */}
      <div className="bg-ink-50 border border-ink-200 rounded-xl p-5 text-sm space-y-3">
        <h3 className="text-sm font-bold text-ink-900">How it works at checkout</h3>
        <ol className="list-decimal pl-5 space-y-2 text-ink-700">
          <li>
            Customer in India picks an INR product. PayCraft's router sees{" "}
            <code className="font-mono bg-white px-1 rounded">direct_upi</code>{" "}
            is enabled + the product is one-time, picks it (priority lower than
            any paid method).
          </li>
          <li>
            SDK opens{" "}
            <code className="font-mono bg-white px-1 rounded">
              upi://pay?pa=&lt;your-vpa&gt;&am=999&pn=&lt;your-name&gt;&tn=…&tr=&lt;ref&gt;
            </code>
            . On Android the OS shows the UPI app picker; on iOS the user opens
            their UPI app and scans the QR rendered as a fallback.
          </li>
          <li>
            Customer confirms in their UPI app. Money lands in your bank
            account within seconds. NPCI sends an SMS / push notification
            with the transaction reference (the{" "}
            <code className="font-mono bg-white px-1 rounded">tr</code> field).
          </li>
          <li>
            PayCraft reconciles via the chosen verification mode (manual entry,
            bank-statement polling, or PSP webhook). Subscription status flips
            to active once reconciled.
          </li>
        </ol>
      </div>

      {/* Limitations */}
      <div className="bg-warning-50 border border-warning-200 rounded-xl p-4 text-xs text-warning-900">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Constraints to know about UPI Direct:</strong>
            <ul className="list-disc pl-5 mt-1.5 space-y-1 leading-relaxed">
              <li>
                <strong>No recurring / subscription support.</strong> UPI Autopay
                requires an NPCI-registered mandate which only PSPs (Razorpay,
                Cashfree) can issue. For monthly / annual subs, route those
                products to a PSP method instead.
              </li>
              <li>
                <strong>No automatic verification by default.</strong> You
                choose one of three modes in the form below: manual confirm
                (you click "received" in the dashboard), bank-statement polling
                (needs read-only bank API), or PSP-webhook (use Razorpay as a
                listener even though the transfer itself is direct).
              </li>
              <li>
                <strong>Per-txn caps.</strong> Most banks cap UPI at ₹1 lakh /
                txn for personal accounts and ₹5 lakh for business. NPCI is
                rolling out higher limits for specific MCC codes — check your
                bank.
              </li>
              <li>
                <strong>One VPA per tenant for now.</strong> Multi-VPA round-robin
                is on the roadmap once we add Cashfree / Razorpay UPI as
                fallbacks.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function ValueCard({
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
