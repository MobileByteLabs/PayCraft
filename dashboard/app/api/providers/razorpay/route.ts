import { NextRequest, NextResponse } from "next/server"
import Razorpay from "razorpay"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

interface SaveBody {
  test_key_id: string
  test_key_secret: string
  test_webhook_secret: string
  live_key_id: string
  live_key_secret: string
  live_webhook_secret: string
}

async function validateRazorpayKeys(
  keyId: string,
  keySecret: string,
  mode: "test" | "live",
): Promise<string | null> {
  const prefix = mode === "test" ? "rzp_test_" : "rzp_live_"
  if (!keyId.startsWith(prefix)) {
    return `${mode}_key_id must start with ${prefix}`
  }
  try {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret })
    await (client as any).payments.all({ count: 1 })
    return null
  } catch (e: any) {
    return `${mode} key invalid: ${e.message}`
  }
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as SaveBody

  // Validate both key pairs before saving anything.
  const [testErr, liveErr] = await Promise.all([
    validateRazorpayKeys(body.test_key_id, body.test_key_secret, "test"),
    validateRazorpayKeys(body.live_key_id, body.live_key_secret, "live"),
  ])
  if (testErr) return NextResponse.json({ error: testErr }, { status: 400 })
  if (liveErr) return NextResponse.json({ error: liveErr }, { status: 400 })

  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_providers_save_keys", {
    p_tenant_id: tenant.id,
    p_provider: "razorpay",
    p_test_key_id: body.test_key_id,
    p_test_secret: body.test_key_secret,
    p_test_webhook_secret: body.test_webhook_secret,
    p_live_key_id: body.live_key_id,
    p_live_secret: body.live_key_secret,
    p_live_webhook_secret: body.live_webhook_secret,
    p_supported_locales: ["IN"],
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
