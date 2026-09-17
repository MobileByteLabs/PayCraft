export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * What this app resolves to for one provider — pinned connection, inherited default, or nothing.
 *
 * Exists so the picker can stand on its own. The Google Play and App Store pages are server
 * components and could pass the resolution down as props, but Stripe and Razorpay are large client
 * components that cannot call an RPC at render time. Rather than convert two 1,000+ line pages to
 * fetch-and-thread props, the picker asks for its own state — which also means dropping it onto a
 * new provider page is one line rather than a page refactor.
 */
export async function GET(req: NextRequest) {
  const provider = new URL(req.url).searchParams.get("provider")
  if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 })

  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_provider_resolve", {
    p_tenant: tenant.id,
    p_provider: provider,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ resolved: data })
}
