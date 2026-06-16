import { NextResponse } from "next/server"
import { requireTenant } from "@/lib/tenant"

/**
 * Lightweight self-info endpoint — returns the active tenant + Supabase URL.
 * Used by client components that need to construct tenant-scoped URLs (e.g.
 * the Stripe webhook endpoint at `{supabase}/functions/v1/stripe-webhook/{tenant_id}`).
 */
export async function GET() {
  const { tenant, userId } = await requireTenant()
  return NextResponse.json({
    user_id: userId,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
  })
}
