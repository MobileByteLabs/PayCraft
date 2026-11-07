import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { resolveTenantForUser } from "@/lib/tenant"
import { readState, validateStepWrite, writeStep, type StepWriteInput } from "@/lib/onboarding-state"

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

/**
 * Which app: `?tenant_id=` if given (must be one the caller administers — a non-member id is a 403,
 * never a silent fallback), else the `paycraft_active_app_id` cookie, else the first membership —
 * the same rule `requireTenant()` applies everywhere else.
 *
 * This used to read `tenants ORDER BY created_at DESC LIMIT 1`: the account's NEWEST app, whatever
 * app the caller had selected. An owner with seven apps reconciling reels-downloader read Affirmly's
 * steps. The response now names the tenant it resolved and how, so a caller can check it got the
 * app it meant.
 */
export async function GET(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const requested = new URL(req.url).searchParams.get("tenant_id")
  const resolved = await resolveTenantForUser(supabase, requested)
  if (resolved.resolvedFrom === "not_a_member") {
    return NextResponse.json({ error: "tenant_not_reachable" }, { status: 403 })
  }

  let tenant = null
  if (resolved.tenantId) {
    const { data } = await supabase
      .from("tenants")
      .select("id, name, api_key_test, api_key_live")
      .eq("id", resolved.tenantId)
      .maybeSingle()
    tenant = data ?? null
  }

  const { customer, app } = await readState(supabase, tenant?.id ?? null, auth.user.id)
  return NextResponse.json({
    tenant,
    tenant_id: tenant?.id ?? null,
    resolved_from: resolved.resolvedFrom,
    customer,
    app,
  })
}

/**
 * Record a wizard step. Validation is shared with `/api/v1/onboarding/state` (lib/onboarding-state),
 * so both writers accept exactly the same thing. `evidence` is REQUIRED for `passed` and `failed`
 * (the trigger enforces it too); `blocked` needs a reason from the closed enum.
 */
export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as StepWriteInput
  const v = validateStepWrite(body)
  if (!v.ok) {
    return NextResponse.json(v.detail ? { error: v.error, detail: v.detail } : { error: v.error }, { status: 400 })
  }

  // RLS (oas_owner_rw / ocs_owner_rw) authorizes the key value for this user's client.
  const keyVal = v.value.scope === "customer" ? auth.user.id : v.value.tenant_id!
  const { steps, error } = await writeStep(supabase, v.value, keyVal)
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ ok: true, scope: v.value.scope, status: v.value.status, steps })
}
