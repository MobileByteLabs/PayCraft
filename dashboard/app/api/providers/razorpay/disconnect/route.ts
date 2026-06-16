import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Razorpay disconnect — removes the saved API keys.
 *
 * Existing Razorpay subscriptions on the merchant's account keep running
 * (we're not deauthorizing anything Razorpay-side); we just clear
 * PayCraft's link to the account. The merchant can re-connect at any time
 * by pasting fresh keys.
 */
export async function DELETE() {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  const { error } = await supabase
    .from("tenant_providers")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("provider", "razorpay")
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "razorpay.disconnected",
    p_resource: `tenant_providers:provider=razorpay`,
  })

  return NextResponse.json({ ok: true })
}
