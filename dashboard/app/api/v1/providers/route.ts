import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

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
