import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Routing rules CRUD for the `/providers/routing` admin page.
 *
 *   GET    — list all rules for this tenant (ordered by priority asc).
 *   POST   — create a new rule.
 *   DELETE /api/routing-rules/{id} — handled by the dynamic [id] route.
 *
 * Schema lives in migration 060. Each rule matches on
 * (country_code, currency, product_type) — NULL = wildcard — and supplies
 * an ordered `priority_methods[]` list the router tries in sequence.
 *
 * Authorisation is handled by the RPC's tenant_admins check; we don't
 * re-validate here.
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_routing_rules_list", {
    p_tenant_id: tenant.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const body = await req.json()

  const country_code = (body?.country_code ?? "").toString().trim() || null
  const currency = (body?.currency ?? "").toString().trim() || null
  const product_type = (body?.product_type ?? "").toString().trim() || null
  const priority_methods = Array.isArray(body?.priority_methods)
    ? body.priority_methods.filter((m: any) => typeof m === "string")
    : []
  const priority = Number.isFinite(body?.priority) ? Number(body.priority) : 100

  if (priority_methods.length === 0) {
    return NextResponse.json(
      { error: "priority_methods must contain at least one method" },
      { status: 400 },
    )
  }
  if (country_code && !/^[A-Za-z]{2}$/.test(country_code)) {
    return NextResponse.json(
      { error: "country_code must be 2-letter ISO 3166-1 alpha-2 or empty" },
      { status: 400 },
    )
  }
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    return NextResponse.json(
      { error: "currency must be 3-letter ISO 4217 or empty" },
      { status: 400 },
    )
  }
  if (product_type && !["subscription", "trial", "lifetime"].includes(product_type)) {
    return NextResponse.json(
      { error: "product_type must be subscription / trial / lifetime or empty" },
      { status: 400 },
    )
  }

  const { data: id, error } = await supabase.rpc("tenant_routing_rules_upsert", {
    p_tenant_id: tenant.id,
    p_country_code: country_code?.toUpperCase() ?? null,
    p_currency: currency?.toUpperCase() ?? null,
    p_product_type: product_type ?? null,
    p_priority_methods: priority_methods,
    p_priority: priority,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "routing_rule.created",
    p_resource: `tenant_routing_rules:id=${id}`,
    p_after: { country_code, currency, product_type, priority_methods, priority },
  })

  return NextResponse.json({ id, ok: true })
}
