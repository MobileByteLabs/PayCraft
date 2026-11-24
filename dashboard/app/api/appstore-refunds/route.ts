export const runtime = "edge"

// Providers ▸ App Store ▸ Refund requests (migration 207). PUT { consent, refundPreference } sets whether PayCraft
// answers Apple's CONSUMPTION_REQUEST for this app and with which refund preference. requireTenant() proves the
// caller administers the tenant; the write goes through the service role because `tenants` is not user-writable.

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { isRefundPreference } from "@/lib/appstore-refunds"

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json().catch(() => null)) as { consent?: unknown; refundPreference?: unknown } | null
  if (!body || typeof body.consent !== "boolean" || !isRefundPreference(body.refundPreference)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 })
  }
  const after = { appstore_consumption_consent: body.consent, appstore_refund_preference: body.refundPreference }
  const { error } = await createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).from("tenants").update(after).eq("id", tenant.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await createClient().rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "appstore_refunds.update",
    p_resource: `tenants:id=${tenant.id}`,
    p_after: after,
  })
  return NextResponse.json(after)
}
