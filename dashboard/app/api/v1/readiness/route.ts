import { NextResponse } from "next/server"
import { requireApiKey, isFailure, auditApiAction } from "@/lib/api-key-auth"
import { queryFailed, withSecurityHeaders } from "@/lib/api-security"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/readiness — per-provider, per-mode readiness for the key's tenant.
 *
 * The machine-facing twin of the Providers page's readiness panel. Answers the question a CI job
 * actually has: "can this app transact in test mode yet, and if not, what is missing?"
 *
 * No tenant parameter — the tenant comes from the key (see api-key-auth, rule 1).
 */
export async function GET(req: Request) {
  const ctx = await requireApiKey(req, "readiness:read")
  if (isFailure(ctx)) return ctx.failed

  const { data, error } = await ctx.admin.rpc("tenant_providers_mode_readiness", {
    p_tenant_id: ctx.tenantId,
  })
  if (error) {
    return queryFailed("v1/readiness", error)
  }

  // The full row is returned to the caller; this type names every field so the API contract is
  // readable here rather than only in the migration. `manual_steps` and `console_url` matter most
  // for a machine caller: Play and App Store test mode has NO API to call, so an automated
  // onboarding flow can do nothing but print these steps to whoever is running it.
  const rows = (data ?? []) as Array<{
    provider: string
    auth_kind: string
    is_active: boolean
    live_ready: boolean
    test_ready: boolean
    live_detail: string
    test_detail: string
    test_mechanism: string
    human_action: string | null
    manual_steps: string[] | null
    console_url: string | null
  }>

  return withSecurityHeaders(
    NextResponse.json({
    tenant_id: ctx.tenantId,
    providers: rows,
    summary: {
      total: rows.length,
      // Surfaced so a caller can branch on "is there anything a human must do?" without
      // re-deriving it from every row.
      needs_manual_action: rows.filter((r) => (r.manual_steps?.length ?? 0) > 0).length,
      live_ready: rows.filter((r) => r.live_ready).length,
      test_ready: rows.filter((r) => r.test_ready).length,
    },
    }),
  )
}
