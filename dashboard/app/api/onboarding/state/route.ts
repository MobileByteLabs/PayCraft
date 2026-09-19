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
 *
 * SINGLE WRITER (RULE-PAYCRAFT-ONBOARD-SOT-001). This route is now the ONLY thing that writes
 * onboarding state. `/idea-paycraft*` used to upsert the tables directly as well, and two writers to
 * one table is not a source of truth — whichever ran last won, and neither could tell whose work the
 * row described. The commands now READ this state and write corrections back through here.
 *
 * That makes recording a FAILURE a first-class case, not an edge one: a command that re-verifies a
 * step and finds it drifted must be able to say so. Writing only successes would let a heal rewrite
 * history — the app would never appear to have been broken. It was: A5 "products synced" sat green
 * for four days carrying {"count":3,"app_store":3,"read_back":true} while those products were
 * unsellable. That window has to be recordable.
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
/** Statuses the DB trigger understands. Anything else is refused before it reaches the constraint. */
const STATUSES = ["passed", "blocked"] as const
type Status = (typeof STATUSES)[number]

/**
 * `onboarding_blocked_reason` enum members. Duplicated here ON PURPOSE so a bad value returns a 400
 * naming the valid set, rather than the trigger's raw `invalid input value for enum` 500 — the
 * caller is usually an agent, and an actionable error is the difference between a heal and a retry
 * loop. Drift is caught by the route test, which asserts this list against the database.
 */
const BLOCKED_REASONS = [
  "pending-provider-credential",
  "pending-account-api-key",
  "provider-api-unavailable",
  "pending-device-verify",
  "pending-webhook-roundtrip",
] as const

export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string
    step_id?: string
    status?: string
    evidence?: Record<string, unknown>
    blocked_reason?: string
    scope?: "app" | "customer"
  }

  const scope = body.scope ?? "app"
  const status = (body.status ?? "passed") as Status

  if (!body.step_id) {
    return NextResponse.json({ error: "step_id is required" }, { status: 400 })
  }
  if (scope === "app" && !body.tenant_id) {
    return NextResponse.json({ error: "tenant_id is required for scope=app" }, { status: 400 })
  }
  if (!STATUSES.includes(status)) {
    return NextResponse.json(
      { error: "invalid_status", detail: `status must be one of: ${STATUSES.join(", ")}` },
      { status: 400 },
    )
  }
  if (status === "passed" && !body.evidence) {
    // Refused here as well as by the trigger, so the caller gets a 400 explaining the contract
    // rather than a raw constraint violation.
    return NextResponse.json(
      { error: "evidence_required", detail: "a step cannot be marked passed without evidence" },
      { status: 400 },
    )
  }
  if (status === "blocked") {
    if (!body.blocked_reason) {
      return NextResponse.json(
        { error: "blocked_reason_required", detail: `one of: ${BLOCKED_REASONS.join(", ")}` },
        { status: 400 },
      )
    }
    if (!BLOCKED_REASONS.includes(body.blocked_reason as (typeof BLOCKED_REASONS)[number])) {
      return NextResponse.json(
        { error: "invalid_blocked_reason", detail: `one of: ${BLOCKED_REASONS.join(", ")}` },
        { status: 400 },
      )
    }
  }

  const table = scope === "customer" ? "onboarding_customer_state" : "onboarding_app_state"
  const keyCol = scope === "customer" ? "owner_user_id" : "tenant_id"
  const keyVal = scope === "customer" ? auth.user.id : body.tenant_id!

  const { data: existing } = await supabase
    .from(table)
    .select("steps")
    .eq(keyCol, keyVal)
    .maybeSingle()

  const steps = Array.isArray(existing?.steps) ? (existing!.steps as any[]) : []
  const next = steps.filter((s) => s?.id !== body.step_id)
  next.push({
    id: body.step_id,
    status,
    // `evidence` carries the probe result for a pass; for a blocked step it is optional context
    // (what was observed), and `blocked_reason` is the machine-readable part the trigger checks.
    ...(body.evidence ? { evidence: body.evidence } : {}),
    ...(status === "blocked" ? { blocked_reason: body.blocked_reason } : {}),
    verified_at: new Date().toISOString(),
  })

  // `current_step` points at where the chain actually IS. On a pass that is the step just completed;
  // on a block it is the step needing attention — NOT the next one. Advancing past a blocked step
  // would make the cursor claim progress the evidence contradicts.
  const { error } = await supabase
    .from(table)
    .upsert({ [keyCol]: keyVal, current_step: body.step_id, steps: next }, { onConflict: keyCol })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scope, status, steps: next })
}
