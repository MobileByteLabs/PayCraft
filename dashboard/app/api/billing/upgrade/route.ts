import { NextRequest, NextResponse } from "next/server"
import { requireTenant } from "@/lib/tenant"

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const { target_tier } = await req.json()
  if (!["free", "pro", "enterprise"].includes(target_tier)) {
    return NextResponse.json(
      { error: "target_tier must be free|pro|enterprise" },
      { status: 400 },
    )
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_PAYCRAFT_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL!
  const billingFnUrl = `${supabaseUrl}/functions/v1/billing/upgrade`

  const res = await fetch(billingFnUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_id: tenant.id, target_tier }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: body.error ?? "upgrade failed" },
      { status: res.status },
    )
  }
  const body = await res.json()
  return NextResponse.json(body)
}
