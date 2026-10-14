import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/**
 * GET /v1/provider-accounts — the provider credentials this app may attach to.
 *
 * The missing half of provider setup. `POST /v1/providers` resolves the attachable set internally,
 * so before this existed the only way to SEE it was to post without an `account_id` and read the
 * candidates out of a 400 — discovery through an error, the same dead end `GET /v1/apps` removed
 * for tenant ids. An agent asked to "connect Stripe" could not answer "which Stripe?" without
 * first failing a write.
 *
 * ## Never a credential
 *
 * `credential_enc` is masked to `has_credential`. No endpoint decrypts a provider secret, because
 * an API that can read one is a single leaked key away from BEING the provider account. `config`
 * carries only non-secret account-scoped ids (App Store `key_id`/`issuer_id`, Play `client_email`).
 *
 * ## Scoped to what this APP may use
 *
 * Returns accounts whose owner is an owner/admin of this app — the session-free form of the
 * ownership rule in `tenant_provider_attach_admin` (migration 152). An account belonging to an
 * unrelated owner is not listed, so the response cannot enumerate another account's connections.
 *
 * `is_default` answers "which credential does a new app get"; `attached_to_this_app` answers
 * "is this one already wired here", so a caller can tell reconcile from first-time setup.
 */
export async function GET(req: Request) {
  return withApiKey(req, "providers:read", async (ctx) => {
    const provider = new URL(req.url).searchParams.get("provider")

    const { data, error } = await ctx.admin.rpc("provider_accounts_list_for_tenant", {
      p_tenant: ctx.tenantId,
      p_provider: provider && provider.trim() ? provider.trim().toLowerCase() : null,
    })
    if (error) return queryFailed("v1/provider-accounts:list", error) as NextResponse

    const rows = (data ?? []) as Array<Record<string, unknown>>
    return NextResponse.json({
      data: rows,
      // Stated rather than left for the caller to compute: with no default and more than one
      // candidate, POST /v1/providers refuses instead of guessing which account to bill through.
      default_resolvable: rows.length === 1 || rows.some((r) => r.is_default === true),
    })
  })
}
