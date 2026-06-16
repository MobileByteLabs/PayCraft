import Link from "next/link"
import { Inbox, Smartphone } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { UpiIntentsList } from "@/components/upi-payments/upi-intents-list"

/**
 * UPI reconciliation page.
 *
 * Default view: pending intents — payments we generated checkout URLs for
 * but haven't yet confirmed landed in the merchant's bank. The merchant
 * checks their bank SMS / notification for a UPI credit and matches the
 * reference number to a row here, then clicks "Mark paid" to:
 *
 *   1. Set the intent status='paid'
 *   2. Create a `subscriptions` row keyed by (user_email, tenant_id) so
 *      the SDK's isPremium() lookup returns true
 *   3. Emit an audit log entry
 *
 * Tab to "Paid" or "Abandoned" via the filter selector at the top.
 */
export default async function UpiPaymentsPage({
  searchParams,
}: {
  searchParams?: { status?: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const status =
    searchParams?.status === "paid"
      ? "paid"
      : searchParams?.status === "abandoned"
        ? "abandoned"
        : "pending"

  const { data } = await supabase.rpc("upi_payment_intents_list", {
    p_tenant_id: tenant.id,
    p_status: status,
    p_limit: 200,
  })
  const intents = data ?? []

  const counts = await Promise.all([
    supabase
      .from("upi_payment_intents")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "pending"),
    supabase
      .from("upi_payment_intents")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "paid"),
    supabase
      .from("upi_payment_intents")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "abandoned"),
  ])
  const pendingCount = counts[0].count ?? 0
  const paidCount = counts[1].count ?? 0
  const abandonedCount = counts[2].count ?? 0

  return (
    <div>
      <PageHeader
        title="UPI payments"
        subtitle="UPI Direct payments need manual reconciliation — the customer pays via their UPI app, you confirm receipt in your bank, and you mark the row paid here."
      />

      {!pendingCount && status === "pending" && paidCount === 0 && (
        <div className="bg-ink-50/60 border border-ink-200 rounded-xl p-8 text-center mb-6">
          <Inbox className="w-8 h-8 text-ink-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-ink-700 mb-1">
            No UPI activity yet
          </h3>
          <p className="text-xs text-ink-500 max-w-md mx-auto leading-relaxed">
            Once a customer opens a UPI Direct checkout URL the intent appears
            here. Make sure UPI Direct is configured at{" "}
            <Link
              href="/providers/upi"
              className="underline font-bold"
            >
              /providers/upi
            </Link>{" "}
            and a customer has at least viewed the option.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-ink-200">
        <TabLink
          href="/upi-payments?status=pending"
          active={status === "pending"}
          label="Pending"
          count={pendingCount}
        />
        <TabLink
          href="/upi-payments?status=paid"
          active={status === "paid"}
          label="Paid"
          count={paidCount}
        />
        <TabLink
          href="/upi-payments?status=abandoned"
          active={status === "abandoned"}
          label="Abandoned"
          count={abandonedCount}
        />
      </div>

      {intents.length > 0 ? (
        <UpiIntentsList intents={intents as any} status={status as any} />
      ) : (
        <div className="bg-white border border-ink-200 rounded-xl p-8 text-center">
          <Smartphone className="w-6 h-6 text-ink-300 mx-auto mb-2" />
          <p className="text-xs text-ink-500">No {status} intents.</p>
        </div>
      )}
    </div>
  )
}

function TabLink({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 -mb-px text-xs font-bold border-b-2 transition-colors ${
        active
          ? "border-brand-600 text-ink-900"
          : "border-transparent text-ink-500 hover:text-ink-700"
      }`}
    >
      {label}{" "}
      <span
        className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-bold ${
          active ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"
        }`}
      >
        {count}
      </span>
    </Link>
  )
}
