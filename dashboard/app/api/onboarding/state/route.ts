import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

/**
 * The wizard's window onto the onboarding SoT.
 *
 * Progress used to live in `useState<Step>`, so a refresh erased it and nothing could resume a
 * half-finished app. These rows are the same ones `/idea-paycraft-onboard-*` writes — one source of
 * truth, two clients — which is what makes a customer resumable from either direction.
 *
 * Note the asymmetry the UI has to respect: step 1 CREATES the tenant, so before it completes there
 * is no `onboarding_app_state` row to read. Tenant existence is therefore the first signal, and the
 * A-chain takes over once there is something to key on.
 */

export async function GET() {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, api_key_test, api_key_live")
    .order("created_at", { ascending: false })
    .limit(1)

  const tenant = tenants?.[0] ?? null

  const { data: customer } = await supabase
    .from("onboarding_customer_state")
    .select("current_step, steps, completed_at")
    .eq("owner_user_id", auth.user.id)
    .maybeSingle()

  let app = null
  if (tenant) {
    const { data } = await supabase
      .from("onboarding_app_state")
      .select("current_step, steps, completed_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle()
    app = data ?? null
  }

  return NextResponse.json({ tenant, customer, app })
}

/**
 * Record a wizard step as reached.
 *
 * `evidence` is REQUIRED by the database trigger for any step marked `passed` — a step cannot be
 * recorded done without the proof that it was. The wizard's evidence is what the operator actually
 * did (a tenant id, a connected provider, a created sku), not a timestamp.
 */
export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string
    step_id?: string
    evidence?: Record<string, unknown>
  }
  if (!body.tenant_id || !body.step_id) {
    return NextResponse.json({ error: "tenant_id and step_id are required" }, { status: 400 })
  }
  if (!body.evidence) {
    // Refused here as well as by the trigger, so the caller gets a 400 explaining the contract
    // rather than a raw constraint violation.
    return NextResponse.json(
      { error: "evidence_required", detail: "a step cannot be marked passed without evidence" },
      { status: 400 },
    )
  }

  const { data: existing } = await supabase
    .from("onboarding_app_state")
    .select("steps")
    .eq("tenant_id", body.tenant_id)
    .maybeSingle()

  const steps = Array.isArray(existing?.steps) ? (existing!.steps as any[]) : []
  const next = steps.filter((s) => s?.id !== body.step_id)
  next.push({
    id: body.step_id,
    status: "passed",
    evidence: body.evidence,
    verified_at: new Date().toISOString(),
  })

  const { error } = await supabase
    .from("onboarding_app_state")
    .upsert({ tenant_id: body.tenant_id, current_step: body.step_id, steps: next }, { onConflict: "tenant_id" })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, steps: next })
}
