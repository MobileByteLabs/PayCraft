import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase.rpc("provision_app", {
    p_app_name: name.trim(),
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function GET() {
  const supabase = createClient()
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")
  const tenantIds = (memberships ?? []).map((r: any) => r.tenant_id)
  if (!tenantIds.length) return NextResponse.json([])

  const { data: apps } = await supabase
    .from("tenants")
    .select("id, name, plan, api_key_live, owner_email, created_at")
    .in("id", tenantIds)
    .order("created_at")

  // Connected providers per app (for the add-app "reuse providers" picker). The
  // tenant-admin SELECT policy scopes this to the caller's apps; only provider
  // NAMES are returned — never any key ciphertext.
  const { data: provRows } = await supabase
    .from("tenant_providers")
    .select("tenant_id, provider, is_active, live_key_id, test_key_id, store_config")
    .in("tenant_id", tenantIds)

  // A non-secret account identifier per provider, so the operator can verify WHICH
  // account each connection uses before copying it: Google Play → service-account
  // email; App Store → issuer id; Stripe/Razorpay → masked public key id. No secret.
  type ProvRow = {
    tenant_id: string
    provider: string
    is_active: boolean
    live_key_id: string | null
    test_key_id: string | null
    store_config: Record<string, unknown> | null
  }
  const mask = (k: string) => (k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k)
  const accountOf = (r: ProvRow): string | null => {
    const cfg = r.store_config ?? {}
    // An operator-supplied label always wins — it's the "which account is this?"
    // answer they chose. Falls back to a provider-natural identifier.
    const label = (cfg.account_label as string) || null
    if (label) return label
    switch (r.provider) {
      case "google_play":
        return (cfg.account_email as string) ?? (cfg.package_name as string) ?? null
      case "app_store":
        return cfg.issuer_id ? `issuer ${String(cfg.issuer_id).slice(0, 8)}…` : ((cfg.bundle_id as string) ?? null)
      case "stripe":
      case "razorpay":
      case "cashfree": {
        const k = r.live_key_id ?? r.test_key_id
        return k ? mask(k) : null
      }
      default:
        return null
    }
  }

  const byTenant: Record<string, { provider: string; account: string | null }[]> = {}
  for (const r of (provRows ?? []) as ProvRow[]) {
    if (r.is_active === false) continue
    ;(byTenant[r.tenant_id] ??= []).push({ provider: r.provider, account: accountOf(r) })
  }

  const withProviders = (apps ?? []).map((a: Record<string, unknown>) => ({
    ...a,
    providers: byTenant[a.id as string] ?? [],
  }))

  return NextResponse.json(withProviders)
}