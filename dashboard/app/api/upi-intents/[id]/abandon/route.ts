import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Mark a pending UPI intent as abandoned (operator cleanup — customer
 * cancelled, chose a different method, or just disappeared).
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  const { error } = await supabase.rpc("upi_payment_intent_abandon", {
    p_intent_id: params.id,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "upi_intent.abandoned",
    p_resource: `upi_payment_intents:id=${params.id}`,
  })

  return NextResponse.json({ ok: true })
}
