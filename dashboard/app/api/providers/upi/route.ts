import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { isValidVpa } from "@/lib/upi"

/**
 * UPI Direct configuration endpoint. Backs the /providers/upi setup form.
 *
 * POST body:
 *   {
 *     enabled: boolean,
 *     config: {
 *       vpa: string,
 *       display_name: string,
 *       merchant_code?: string (4 digit MCC),
 *       verification_mode?: "manual" | "polling" | "psp_webhook"
 *     }
 *   }
 *
 * Persists via `tenant_payment_methods_upsert` (migration 060) with
 * method = 'direct_upi'. The routing engine + SDK config endpoint read
 * this row when picking the cheapest method per (country, currency,
 * product_type).
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const body = await req.json()

  const enabled = !!body?.enabled
  const config = body?.config ?? {}

  // Validate at the API boundary — keep the RPC simple.
  if (enabled) {
    if (!config.vpa || typeof config.vpa !== "string" || !isValidVpa(config.vpa)) {
      return NextResponse.json(
        { error: "invalid VPA — expected `name@bank`" },
        { status: 400 },
      )
    }
    if (!config.display_name || typeof config.display_name !== "string") {
      return NextResponse.json(
        { error: "display_name is required when UPI is enabled" },
        { status: 400 },
      )
    }
    if (config.merchant_code && !/^[0-9]{4}$/.test(config.merchant_code)) {
      return NextResponse.json(
        { error: "merchant_code must be a 4-digit MCC" },
        { status: 400 },
      )
    }
    if (
      config.verification_mode &&
      !["manual", "polling", "psp_webhook"].includes(config.verification_mode)
    ) {
      return NextResponse.json(
        { error: "verification_mode must be one of manual / polling / psp_webhook" },
        { status: 400 },
      )
    }
  }

  const { data: id, error } = await supabase.rpc("tenant_payment_methods_upsert", {
    p_tenant_id: tenant.id,
    p_method: "direct_upi",
    p_enabled: enabled,
    p_config: config,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: enabled ? "upi.configured" : "upi.disabled",
    p_resource: `tenant_payment_methods:id=${id}`,
    // Don't include the raw VPA in the audit-log "after" payload — VPAs
    // double as personal identifiers and the audit log is broadly readable.
    p_after: {
      method: "direct_upi",
      enabled,
      has_vpa: !!config.vpa,
      verification_mode: config.verification_mode ?? null,
    },
  })

  return NextResponse.json({ id, ok: true })
}
