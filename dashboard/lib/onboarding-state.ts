import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The onboarding SoT's read/write rules, shared by the cookie route (`/api/onboarding/state`) and
 * the API-key route (`/api/v1/onboarding/state`, MCP `paycraft_onboarding_*`).
 *
 * One copy on purpose: the route is the SINGLE WRITER of onboarding state
 * (RULE-PAYCRAFT-ONBOARD-SOT-001), and two copies of its validation would be two writers again —
 * whichever was fixed last would decide what the SoT accepts.
 *
 * The client is passed in. The cookie route hands over the user's RLS-bound client; the v1 route
 * hands over the service-role client after requireApiKey has already resolved and authorized the
 * tenant. Either way the DB trigger (117/172) is the backstop for the evidence rules.
 */

/**
 * Statuses a step can be recorded with.
 *   passed  — the claim is true; evidence is the proof.
 *   failed  — the claim was re-verified and is FALSE; evidence is the observed failure (172). This is
 *             what lets a drifted step be demoted before it is healed (onboard-sot rule 5).
 *   blocked — waiting on something external; blocked_reason from the closed enum.
 */
export const STATUSES = ["passed", "failed", "blocked"] as const
export type StepStatus = (typeof STATUSES)[number]

/**
 * `onboarding_blocked_reason` enum members. Duplicated here ON PURPOSE so a bad value returns a 400
 * naming the valid set, rather than the trigger's raw `invalid input value for enum` 500 — the
 * caller is usually an agent, and an actionable error is the difference between a heal and a retry
 * loop. Drift against the database is caught by the SQL test for 172 plus the route test.
 */
export const BLOCKED_REASONS = [
  "pending-provider-credential",
  "pending-account-api-key",
  "provider-api-unavailable",
  "pending-device-verify",
  "pending-webhook-roundtrip",
] as const

export interface StepWriteInput {
  tenant_id?: string
  step_id?: string
  status?: string
  evidence?: Record<string, unknown>
  blocked_reason?: string
  scope?: "app" | "customer"
}

export interface StepWrite {
  scope: "app" | "customer"
  tenant_id: string | null
  step_id: string
  status: StepStatus
  evidence?: Record<string, unknown>
  blocked_reason?: string
}

export type Validated = { ok: true; value: StepWrite } | { ok: false; error: string; detail?: string }

/** Validate a step write. Every rejection is a 400 the caller can act on. */
export function validateStepWrite(body: StepWriteInput): Validated {
  const scope = body.scope ?? "app"
  const status = (body.status ?? "passed") as StepStatus

  if (scope !== "app" && scope !== "customer") {
    return { ok: false, error: "invalid_scope", detail: "scope must be app or customer" }
  }
  if (!body.step_id) return { ok: false, error: "step_id is required" }
  if (scope === "app" && !body.tenant_id) return { ok: false, error: "tenant_id is required for scope=app" }
  if (!STATUSES.includes(status)) {
    return { ok: false, error: "invalid_status", detail: `status must be one of: ${STATUSES.join(", ")}` }
  }
  if ((status === "passed" || status === "failed") && !body.evidence) {
    // Refused here as well as by the trigger, so the caller gets a 400 explaining the contract
    // rather than a raw constraint violation. For `failed` the evidence IS the observed failure.
    return {
      ok: false,
      error: "evidence_required",
      detail:
        status === "passed"
          ? "a step cannot be marked passed without evidence"
          : "a step cannot be marked failed without evidence of the observed failure",
    }
  }
  if (status === "blocked") {
    if (!body.blocked_reason) {
      return { ok: false, error: "blocked_reason_required", detail: `one of: ${BLOCKED_REASONS.join(", ")}` }
    }
    if (!BLOCKED_REASONS.includes(body.blocked_reason as (typeof BLOCKED_REASONS)[number])) {
      return { ok: false, error: "invalid_blocked_reason", detail: `one of: ${BLOCKED_REASONS.join(", ")}` }
    }
  }
  return {
    ok: true,
    value: {
      scope,
      tenant_id: body.tenant_id ?? null,
      step_id: body.step_id,
      status,
      ...(body.evidence ? { evidence: body.evidence } : {}),
      ...(status === "blocked" ? { blocked_reason: body.blocked_reason } : {}),
    },
  }
}

/**
 * Upsert one step. `keyVal` is the tenant id (scope=app) or the owner user id (scope=customer) —
 * the caller supplies it from an AUTHORIZED source, never straight from the body for customer scope.
 */
export async function writeStep(
  client: SupabaseClient<any>,
  w: StepWrite,
  keyVal: string,
): Promise<{ steps: any[]; error: string | null }> {
  const table = w.scope === "customer" ? "onboarding_customer_state" : "onboarding_app_state"
  const keyCol = w.scope === "customer" ? "owner_user_id" : "tenant_id"

  const { data: existing } = await client.from(table).select("steps").eq(keyCol, keyVal).maybeSingle()

  const steps = Array.isArray(existing?.steps) ? (existing!.steps as any[]) : []
  const next = steps.filter((s) => s?.id !== w.step_id)
  next.push({
    id: w.step_id,
    status: w.status,
    // `evidence` is the probe result for a pass, the observed failure for a fail, and optional
    // context for a block (where `blocked_reason` is the machine-readable part the trigger checks).
    ...(w.evidence ? { evidence: w.evidence } : {}),
    ...(w.status === "blocked" ? { blocked_reason: w.blocked_reason } : {}),
    verified_at: new Date().toISOString(),
  })

  // `current_step` points at where the chain actually IS. On a pass that is the step just completed;
  // on a block or a fail it is the step needing attention — NOT the next one.
  const { error } = await client
    .from(table)
    .upsert({ [keyCol]: keyVal, current_step: w.step_id, steps: next }, { onConflict: keyCol })

  return { steps: next, error: error ? error.message : null }
}

/** Read one app's state, plus the owner's customer state when an owner is known. */
export async function readState(client: SupabaseClient<any>, tenantId: string | null, ownerUserId: string | null) {
  let customer = null
  if (ownerUserId) {
    const { data } = await client
      .from("onboarding_customer_state")
      .select("current_step, steps, completed_at")
      .eq("owner_user_id", ownerUserId)
      .maybeSingle()
    customer = data ?? null
  }

  let app = null
  if (tenantId) {
    const { data } = await client
      .from("onboarding_app_state")
      .select("current_step, steps, completed_at")
      .eq("tenant_id", tenantId)
      .maybeSingle()
    app = data ?? null
  }
  return { customer, app }
}
