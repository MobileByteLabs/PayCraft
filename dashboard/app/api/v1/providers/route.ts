import { NextResponse } from "next/server"
import { listResource, withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/** Providers an app can be attached to. Mirrors the `tenant_providers.provider` vocabulary. */
const KNOWN_PROVIDERS = new Set([
  "stripe", "razorpay", "paddle", "lemonsqueezy", "paypal", "paystack", "flutterwave",
  "cashfree", "midtrans", "btcpay", "google_play", "app_store",
])

/**
 * GET /v1/providers — connections attached to this tenant.
 *
 * Deliberately NOT the credentials. Key ids are fingerprints at most; secrets live encrypted and
 * there is no endpoint that decrypts them, because an API that can read a provider secret is one
 * leaked key away from being the provider account.
 */
export async function GET(req: Request) {
  return listResource(req, "providers:read", {
    table: "tenant_providers",
    columns:
      "provider, is_active, provider_account_id, test_payment_links, live_payment_links, " +
      "supported_locales, created_at, updated_at",
    orderBy: { column: "provider", ascending: true },
    filters: (q) => ({ provider: q.get("provider") }),
  })
}

/**
 * POST /v1/providers — attach this app to a provider credential the ACCOUNT already holds.
 *
 * ## No credential crosses this boundary
 *
 * The body names an `account_id`, never a key. Provider secrets live encrypted in
 * `provider_accounts.credential_enc`, are read only server-side by the sync, and are never
 * accepted, returned, or logged here. That is what makes provider connection reachable from an
 * automated caller at all: an endpoint that took a `sk_live_…` would put a live secret into every
 * client that called it, including an MCP transcript.
 *
 * ## Which accounts are attachable
 *
 * Those whose owner is an owner/admin of THIS app — see `tenant_provider_attach_admin` (152). The
 * id is a request, not a grant: an account outside that set is refused with the same wording as a
 * nonexistent one, so the error cannot enumerate another account's connections.
 *
 * Omit `account_id` and the account's DEFAULT connection for that provider is used, which is the
 * whole point of `is_default` — "which credential does a new app use" must not depend on the
 * caller guessing a UUID.
 *
 * ## It does not make anything sellable
 *
 * Attaching tells PayCraft which credential to transact with. Products still have to be synced,
 * and both native stores still require a real sandbox purchase before they report test-ready.
 */
export async function POST(req: Request) {
  return withApiKey(req, "providers:write", async (ctx) => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })
    }

    const provider = String(body.provider ?? "").trim().toLowerCase()
    if (!provider) return NextResponse.json({ error: "provider_required" }, { status: 400 })
    if (!KNOWN_PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: "provider_unknown", detail: `known: ${[...KNOWN_PROVIDERS].sort().join(", ")}` },
        { status: 400 },
      )
    }
    for (const forbidden of ["secret", "api_key", "test_secret", "live_secret", "credential", "key"]) {
      if (forbidden in body) {
        return NextResponse.json(
          {
            error: `credential_not_accepted:${forbidden}`,
            detail:
              "Provider secrets are held by the account and never travel through this API. " +
              "Attach by account_id; add or rotate the credential itself in the dashboard.",
          },
          { status: 400 },
        )
      }
    }

    // What this app may attach to, resolved server-side rather than trusted from the body.
    const { data: accountsRaw, error: listError } = await ctx.admin.rpc(
      "provider_accounts_list_for_tenant",
      { p_tenant: ctx.tenantId, p_provider: provider },
    )
    if (listError) return queryFailed("v1/providers:accounts", listError) as NextResponse
    const accounts = (accountsRaw ?? []) as Array<Record<string, unknown>>

    if (accounts.length === 0) {
      return NextResponse.json(
        {
          error: "no_provider_account",
          detail:
            `This account holds no ${provider} connection. Add one in the dashboard (the ` +
            "credential is entered there and stays there); then attach it here.",
        },
        { status: 409 },
      )
    }

    let accountId = typeof body.account_id === "string" ? body.account_id.trim() : ""
    if (!accountId) {
      const def = accounts.find((a) => a.is_default === true) ?? (accounts.length === 1 ? accounts[0] : null)
      if (!def) {
        // Never pick arbitrarily — same rule the account-scoped key follows for tenants. Naming
        // the candidates is safe: the caller is authorized for every one of them.
        return NextResponse.json(
          {
            error: "account_id_required",
            detail: `this app can attach to ${accounts.length} ${provider} connections and none is default`,
            accounts: accounts.map((a) => ({ id: a.id, label: a.label })),
          },
          { status: 400 },
        )
      }
      accountId = String(def.id)
    }

    const appConfig: Record<string, unknown> = {}
    if (typeof body.package_name === "string") appConfig.package_name = body.package_name
    if (typeof body.bundle_id === "string") appConfig.bundle_id = body.bundle_id

    const { error: attachError } = await ctx.admin.rpc("tenant_provider_attach_admin", {
      p_tenant: ctx.tenantId,
      p_provider: provider,
      p_account_id: accountId,
      p_app_config: Object.keys(appConfig).length > 0 ? appConfig : null,
    })
    if (attachError) {
      // The RPC's opaque refusal is passed through as 404-shaped, not 500: an unattachable id is a
      // caller error, and saying "no such connection" is the deliberate wording.
      if (/no such connection/i.test(attachError.message ?? "")) {
        return NextResponse.json({ error: "no_such_connection" }, { status: 404 })
      }
      return queryFailed("v1/providers:attach", attachError) as NextResponse
    }

    await auditApiAction(ctx, "provider.attach", "tenant_providers", { provider, account_id: accountId })

    const chosen = accounts.find((a) => String(a.id) === accountId)
    return NextResponse.json({
      provider,
      account_id: accountId,
      label: chosen?.label ?? null,
      has_credential: chosen?.has_credential ?? null,
      attached: true,
      // Attached ≠ sellable. Saying so here stops the "it's connected so it must work" reading.
      next: "GET /v1/readiness — attaching selects a credential; it does not prove the provider can transact.",
    })
  })
}
