import { supabaseAdmin } from "./supabase-admin.ts";

/**
 * Resolve which APP (tenant) an inbound provider event belongs to.
 *
 * ## Why this is one function and not three
 *
 * Outbound traffic (the v1 API and MCP) is account-authenticated: the caller presents an account
 * access token plus the app's api key, and `requireApiKey` refuses to act on an app the key does
 * not reach. Inbound traffic has no key to carry — the PROVIDER calls us — so the app has to be
 * recovered from the event itself. That is a real asymmetry and it cannot be removed.
 *
 * What CAN be removed is three different recoveries. Before this helper there were:
 *
 *   1. web PSPs — tenant in the URL path, with a sole-tenant fallback inlined in
 *      `handleSubscriptionEvent`;
 *   2. the store lanes — nothing at all, so `entitlement-reconcile` recorded `tenantId: null` for
 *      every Play and App Store subscription;
 *   3. store consumables — an ad-hoc `tenants.app_identifier` lookup written for the grant path.
 *
 * Three recoveries meant three places to get multi-tenant attribution wrong, and (2) was already
 * wrong: a store subscription with a NULL tenant never matches
 * `check_premium_with_device()`'s `tenant_id IS NOT DISTINCT FROM` filter, so `is_premium` reads
 * false for a customer who has paid. Every inbound lane now resolves through here.
 *
 * ## Order, and why
 *
 * 1. **URL path** — explicit, and the only one that cannot be ambiguous. Always wins.
 * 2. **App identifier** — Play's `packageName`, Apple's `bundleId`, matched against
 *    `tenants.app_identifier` (migration 111: owned by the app, read by both stores). This is the
 *    store lanes' real attribution, because their endpoints are per-DEPLOYMENT: one Pub/Sub topic
 *    and one ASSN URL serve every tenant.
 * 3. **Sole provider tenant** — if exactly one tenant has this provider configured, attribute to
 *    it and warn. More than one is AMBIGUOUS and throws: writing a NULL-tenant row would silently
 *    deny access to a paying customer, and guessing would credit the wrong app's ledger.
 * 4. **Null** — zero provider tenants is a genuine single-tenant self-hosted deployment, where
 *    NULL is correct.
 *
 * Resolving on the PRODUCT id is deliberately NOT one of these. Two tenants can both sell a sku
 * called `coins_550`, so a product-only lookup either errors on multiple rows or puts one app's
 * purchase into another app's ledger.
 */
export interface InboundTenantInput {
  /** Tenant from the webhook URL path, when the endpoint is per-tenant. */
  tenantIdFromPath?: string | null;
  /** Play `packageName` / Apple `bundleId` — the app the purchase happened in. */
  appIdentifier?: string | null;
  /** Provider name, for the sole-tenant fallback and the error message. */
  provider: string;
}

export interface InboundTenantResult {
  tenantId: string | null;
  /** How it was resolved — surfaced so a caller can log a weak attribution. */
  via: "path" | "app_identifier" | "sole_provider_tenant" | "self_hosted";
}

export async function resolveInboundTenant(
  input: InboundTenantInput,
): Promise<InboundTenantResult> {
  const { tenantIdFromPath, appIdentifier, provider } = input;

  if (tenantIdFromPath) return { tenantId: tenantIdFromPath, via: "path" };

  if (appIdentifier) {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("app_identifier", appIdentifier)
      .maybeSingle();
    if (error) {
      throw new Error(`tenant lookup by app_identifier failed: ${error.message}`);
    }
    if (data?.id) return { tenantId: data.id as string, via: "app_identifier" };
    // Fall through rather than throw: a deployment that has not backfilled app_identifier yet can
    // still be attributed by the sole-tenant rule below, which is strictly safer than failing a
    // paid purchase outright. If that rule is ambiguous too, it throws there and names the fix.
    console.warn(
      `[inbound-tenant] no tenant has app_identifier ${appIdentifier} — falling back to the sole-${provider}-tenant rule. Set it with tenant_app_identifier_set.`,
    );
  }

  const { data: provRows, error: provError } = await supabaseAdmin
    .from("tenant_providers")
    .select("tenant_id")
    .eq("provider", provider);
  if (provError) {
    throw new Error(`tenant_providers lookup failed for ${provider}: ${provError.message}`);
  }
  // Array.isArray, not `?? []`: PostgREST answers an OBJECT on error and some transports hand back
  // a non-array body, and `.map` on either throws a TypeError that surfaces as a 500 the provider
  // then retries forever. The previous `(provRows ?? []).map(...)` had exactly that defect — it was
  // the real cause of the long-standing AC-24 failure, which looked like a test bug and was not.
  const rows: Array<{ tenant_id: string | null }> = Array.isArray(provRows) ? provRows : [];
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))];

  if (tenantIds.length === 1) {
    console.warn(
      `[inbound-tenant] attributed to the sole ${provider} tenant ${tenantIds[0]} — no tenant in the URL path and no app_identifier match. Fix the webhook endpoint or set app_identifier.`,
    );
    return { tenantId: tenantIds[0] as string, via: "sole_provider_tenant" };
  }
  if (tenantIds.length > 1) {
    throw new Error(
      `Ambiguous tenant: ${tenantIds.length} tenants have provider '${provider}'. The webhook URL must include /{tenant_id}, or the app must set app_identifier.`,
    );
  }

  return { tenantId: null, via: "self_hosted" };
}
