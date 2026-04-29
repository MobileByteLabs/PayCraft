import { createClient } from "@/lib/supabase-server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Creates a Stripe Checkout Session for PayCraft Cloud plan upgrade.
 * POST /api/create-checkout { plan: "pro"|"enterprise", tenant_id: "..." }
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { plan, tenant_id } = await request.json()

  // Verify user owns this tenant
  const { data: admin } = await supabase
    .from("tenant_admins")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("tenant_id", tenant_id)
    .in("role", ["owner", "admin"])
    .single()

  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Price IDs — set these in environment or hardcode for now
  const priceMap: Record<string, string> = {
    pro: process.env.STRIPE_PRO_PRICE_ID || "price_pro_monthly",
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || "price_enterprise_monthly",
  }

  const priceId = priceMap[plan]
  if (!priceId) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }

  // Create Stripe Checkout Session via Supabase Edge Function
  // In production, this would call Stripe directly or via an Edge Function
  const stripeKey = process.env.PAYCRAFT_CLOUD_STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(stripeKey)

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tenant_id },
    customer_email: session.user.email || undefined,
    success_url: `${request.headers.get("origin")}/settings?upgraded=true`,
    cancel_url: `${request.headers.get("origin")}/upgrade`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}
