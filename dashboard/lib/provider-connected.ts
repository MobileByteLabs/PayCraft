/**
 * Is a `tenant_providers` row an actual CONNECTION, or merely an intent to connect?
 *
 * A row is not a connection. Both provider surfaces used to treat any row for the tenant as
 * connected — `select("provider")` with no filter — so a row written with `is_active = true` and no
 * credential rendered as "Connected". That is exactly what an interrupted or preview-mode onboarding
 * leaves behind, and the Products page disagreed because it reads the credential instead.
 *
 * Offering an unconnected provider as routable is not cosmetic: a routing rule or platform primary
 * pointed at it sends real customers to a provider that cannot charge them.
 *
 * Only NON-SECRET columns are consulted. `*_key_id` is a public identifier (`rzp_live_…`,
 * `pk_live_…`) written by the same save that stores the encrypted secret, so its presence implies
 * the secret without ever pulling ciphertext into the app. Native stores are evidenced the same way,
 * by the identifier stored beside their credential.
 */
export type ProviderRow = {
  provider: string
  is_active?: boolean | null
  live_key_id?: string | null
  test_key_id?: string | null
  store_config?: Record<string, unknown> | null
}

/** The columns `isProviderConnected` needs — keep queries and rule in one place. */
export const PROVIDER_CONNECTED_COLUMNS =
  "provider, is_active, live_key_id, test_key_id, store_config"

export function isProviderConnected(row: ProviderRow | null | undefined): boolean {
  if (!row?.is_active) return false
  const cfg = (row.store_config ?? {}) as Record<string, unknown>
  const has = (k: string) => typeof cfg[k] === "string" && (cfg[k] as string).length > 0

  switch (row.provider) {
    // Native stores: the credential is useless without the identifier that targets an app, and an
    // empty store_config is precisely the "no bundle_id configured" state the Products page reports.
    case "google_play":
      return has("package_name")
    case "app_store":
      return has("bundle_id")
    // Every web PSP (stripe, razorpay, cashfree, upi…): a saved key pair, either mode.
    default:
      return Boolean(row.live_key_id || row.test_key_id)
  }
}

/** Distinct provider ids that are genuinely connected. */
export function connectedProviderIds(rows: ProviderRow[] | null | undefined): string[] {
  return [...new Set((rows ?? []).filter(isProviderConnected).map((r) => r.provider))]
}
