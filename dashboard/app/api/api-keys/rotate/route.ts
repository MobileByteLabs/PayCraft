import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { captureKeyRotated } from "@/lib/sentry-events"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const mode = new URL(req.url).searchParams.get("mode") as "test" | "live"
  if (mode !== "test" && mode !== "live") {
    return NextResponse.json({ error: "mode_required" }, { status: 400 })
  }
  const supabase = createClient()
  const newKey = `pk_${mode}_${crypto.randomBytes(24).toString("hex")}`
  const column = mode === "test" ? "api_key_test" : "api_key_live"
  const tsColumn = mode === "test" ? "api_key_test_rotated_at" : "api_key_live_rotated_at"
  const oldKey = mode === "test" ? tenant.api_key_test : tenant.api_key_live
  const { error } = await supabase
    .from("tenants")
    .update({ [column]: newKey, [tsColumn]: new Date().toISOString() })
    .eq("id", tenant.id)
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: `api_key.rotated.${mode}`,
    p_resource: `tenants:id=${tenant.id}`,
    p_before: { [column]: oldKey.substring(0, 11) + "•••" },
    p_after: { [column]: newKey.substring(0, 11) + "•••" },
  })

  try {
    captureKeyRotated({ tenantId: tenant.id, userId, mode })
  } catch {
    // Sentry failures are non-blocking — rotation already succeeded.
  }

  return NextResponse.json({ ok: true })
}
