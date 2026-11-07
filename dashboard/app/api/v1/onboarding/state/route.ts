import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction, type ApiKeyContext } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
import { readState, validateStepWrite, writeStep, type StepWriteInput } from "@/lib/onboarding-state"
export const dynamic = "force-dynamic"

/**
 * The onboarding SoT over an API key — the route `/idea-paycraft*` reads and writes through.
 *
 * Same rules as the cookie route (/api/onboarding/state): both call lib/onboarding-state, so this is
 * a second CLIENT of the single writer, not a second writer. The tenant comes from requireApiKey
 * (an account key must name it; an app key is pinned to its own), never from the body.
 */

/** The account owner behind an account-scoped key; null for an app key (it has no owner user). */
async function keyOwner(ctx: ApiKeyContext): Promise<string | null> {
  if (!ctx.accountScoped) return null
  const { data } = await ctx.admin.from("tenant_api_keys").select("owner_user_id").eq("id", ctx.keyId).maybeSingle()
  return (data?.owner_user_id as string | undefined) ?? null
}

/** GET /v1/onboarding/state — this app's state, plus the key owner's customer state when known. */
export async function GET(req: Request) {
  return withApiKey(req, "onboarding:read", async (ctx) => {
    const { customer, app } = await readState(ctx.admin, ctx.tenantId, await keyOwner(ctx))
    return NextResponse.json({ tenant_id: ctx.tenantId, customer, app })
  })
}

/**
 * PATCH /v1/onboarding/state — record one APP step: `{step_id, status, evidence, blocked_reason?}`.
 * `passed` and `failed` need evidence (for `failed` it is the observed failure — demote before
 * healing); `blocked` needs a reason from the closed enum.
 */
export async function PATCH(req: Request) {
  return withApiKey(req, "onboarding:write", async (ctx) => {
    const input = ((await req.json().catch(() => null)) ?? {}) as StepWriteInput
    if (input.scope && input.scope !== "app") {
      return NextResponse.json(
        { error: "invalid_scope", detail: "the API records app steps only; customer steps belong to the dashboard session" },
        { status: 400 },
      )
    }
    // The tenant is the one requireApiKey resolved — any id in the payload is overwritten, never used.
    const v = validateStepWrite({ ...input, scope: "app", tenant_id: ctx.tenantId })
    if (!v.ok) {
      return NextResponse.json(v.detail ? { error: v.error, detail: v.detail } : { error: v.error }, { status: 400 })
    }

    const { steps, error } = await writeStep(ctx.admin, v.value, ctx.tenantId)
    if (error) return queryFailed("v1/onboarding/state", { message: error }) as NextResponse

    await auditApiAction(ctx, "onboarding.step_recorded", `onboarding_app_state:tenant_id=${ctx.tenantId}`, {
      step_id: v.value.step_id,
      status: v.value.status,
    })
    return NextResponse.json({ ok: true, tenant_id: ctx.tenantId, status: v.value.status, steps })
  })
}
