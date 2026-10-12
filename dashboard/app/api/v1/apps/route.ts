import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/**
 * GET /v1/apps — every app this key reaches.
 *
 * The missing first step of automated onboarding: an account key previously had to be TOLD a
 * tenant id before it could do anything, and the only way to learn one was to trigger the
 * `tenant_required` error and read the list out of its message. Which worked, but meant the
 * discovery path was an error string.
 */
export async function GET(req: Request) {
  return withApiKey(req, "apps:read", async (ctx) => {
    const { data, error } = await ctx.admin
      .from("tenants")
      .select("id, name, created_at")
      .in("id", ctx.reachableTenantIds)
      .order("created_at", { ascending: true })
    if (error) return queryFailed("v1/apps:list", error) as NextResponse

    return NextResponse.json({
      data: (data ?? []).map((t) => ({ ...t, is_current: t.id === ctx.tenantId })),
      account_scoped: ctx.accountScoped,
    })
  })
}

/**
 * POST /v1/apps — create an app under this account.
 *
 * ## Account-scoped keys only
 *
 * Minting a billable app is an ACCOUNT action, so an app-scoped key is refused even when it
 * carries the scope. Letting one app's key create siblings would turn a single leaked app
 * credential into account-level write access, which is a different blast radius than the key was
 * issued with. `apps:write` is a separate scope for the same reason: `products:write` on one app
 * must not imply the ability to create another.
 *
 * ## Idempotent per (owner, app_name)
 *
 * Re-running returns the existing app and says `created: false`, so an onboarding chain is safe to
 * retry after a partial failure. Deliberately NOT the `provision_tenant` behaviour, which is
 * idempotent per ACCOUNT and hands back the oldest app — the bug that cross-wires a new app's
 * billing onto the first one.
 *
 * Returns the app's PUBLISHABLE key (`pk_…`), which is designed to ship inside the client. No
 * secret or webhook value is returned.
 */
export async function POST(req: Request) {
  return withApiKey(req, "apps:write", async (ctx) => {
    if (!ctx.accountScoped) {
      return NextResponse.json(
        {
          error: "account_scoped_key_required",
          detail:
            "Creating an app is an account action. This key is scoped to a single app, and a key " +
            "that can create siblings has account-level reach it was not issued with.",
        },
        { status: 403 },
      )
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })
    }

    const appName = String(body.app_name ?? "").trim()
    if (!appName) return NextResponse.json({ error: "app_name_required" }, { status: 400 })
    if (appName.length > 120) return NextResponse.json({ error: "app_name_too_long_max_120" }, { status: 400 })

    // `app_identifier` is the STABLE reuse key (applicationId / bundle id). Without it, reuse
    // falls back to a case-insensitive name match — which is how an app named "cappy" in the DB
    // and "Cappy" in the app profile nearly got a SECOND tenant with fresh keys, orphaning the
    // real one. Pass it whenever the caller knows it.
    const appIdentifier =
      typeof body.app_identifier === "string" && body.app_identifier.trim()
        ? body.app_identifier.trim()
        : null

    const { data, error } = await ctx.admin.rpc("provision_app_admin", {
      p_actor_tenant: ctx.tenantId,
      p_app_name: appName,
      p_app_identifier: appIdentifier,
    })
    if (error) return queryFailed("v1/apps:provision", error) as NextResponse

    const result = (data ?? {}) as Record<string, unknown>
    await auditApiAction(ctx, result.created ? "app.create" : "app.reuse", "tenants", {
      tenant_id: result.tenant_id,
      app_name: appName,
    })

    return NextResponse.json(
      {
        ...result,
        // The new app is reachable by this key only after the key's tenant set is re-resolved,
        // which happens on the next request — said plainly so a chain does not 403 mysteriously.
        next:
          `Pass tenant_id=${result.tenant_id} on subsequent calls. ` +
          "Then POST /v1/providers to attach credentials and POST /v1/products to build the catalogue.",
      },
      { status: result.created ? 201 : 200 },
    )
  })
}
