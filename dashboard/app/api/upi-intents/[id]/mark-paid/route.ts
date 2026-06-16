import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Mark a UPI payment intent as paid.
 *
 * POST body:
 *   { customer_email?: string, bank_transaction_id?: string, notes?: string }
 *
 * The RPC creates a corresponding `subscriptions` row keyed by
 * (user_email, tenant_id) so the SDK's existing `isPremium()` lookup
 * returns true on the next refresh. Idempotent: re-running on an
 * already-paid intent raises an error rather than silently double-counting.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const body = await req.json().catch(() => ({}))

  const { data, error } = await supabase
    .rpc("upi_payment_intent_mark_paid", {
      p_intent_id: params.id,
      p_bank_transaction_id: body?.bank_transaction_id ?? null,
      p_notes: body?.notes ?? null,
      p_customer_email: body?.customer_email ?? null,
    })
    .single<{ intent_id: string; subscription_id: string; product_sku: string }>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "upi_intent.marked_paid",
    p_resource: `upi_payment_intents:id=${params.id}`,
    p_after: {
      subscription_id: data?.subscription_id,
      product_sku: data?.product_sku,
      bank_transaction_id: body?.bank_transaction_id ?? null,
      customer_email: body?.customer_email ?? null,
    },
  })

  return NextResponse.json({ ok: true, ...data })
}
