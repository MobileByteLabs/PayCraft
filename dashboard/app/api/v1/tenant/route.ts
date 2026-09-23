import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/**
 * GET /v1/tenant — who this key belongs to, and the plan limits it operates under.
 *
 * The column list is explicit and short ON PURPOSE. `tenants` also holds `api_key_live`,
 * `api_key_test`, `webhook_secret_live` and `webhook_secret_test`; a `select("*")` here would
 * publish every one of them through an endpoint whose whole job is to be safe to call.
 */
export async function GET(req: Request) {
  return withApiKey(req, "tenant:read", async (ctx) => {
    const { data, error } = await ctx.admin
      .from("tenants")
      .select(
        "id, name, plan, status, subscriber_limit, owner_email, country_code, app_identifier, " +
          "billing_period_end, config_cache_ttl_seconds, created_at",
      )
      .eq("id", ctx.tenantId)
      .single()

    if (error) return queryFailed("v1/tenant", error) as NextResponse

    return NextResponse.json({
      ...(data as unknown as Record<string, unknown>),
      // Echoing the key back makes a credential self-describing: a caller can ask what it is
      // allowed to do without a separate endpoint, and a log line shows which key acted.
      key: { id: ctx.keyId, scopes: ctx.scopes },
    })
  })
}
