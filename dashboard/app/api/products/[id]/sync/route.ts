export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { runProductSync, type ProviderSyncEntry } from "@/lib/stripe-route-helper"

/**
 * Re-sync a single product to whichever providers are connected. Useful when a
 * row failed initial sync, when the operator changed pricing and wants to push a
 * fresh Stripe Price / Play offer, or when they re-connected a provider.
 *
 * Delegates to the shared runProductSync orchestrator so classification + durable
 * sync_state recording is IDENTICAL to the create path — every provider outcome
 * carries a human reason (skipped/failed/draft), never an opaque "skipped".
 *
 * Body: {} (operates on the URL's :id only)
 * Returns: { <provider>: { status: "ok"|"failed"|"skipped", message? } } — message
 * is the reason for any non-ok status (not connected / no pricing / type unsupported /
 * trial offer DRAFT-until-published / real error).
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  // Optional ?provider=<name> — sync ONE provider this request. The free
  // Cloudflare tier caps a request at 50 subrequests, which the full 5-provider
  // fan-out exceeds, so the dashboard syncs provider-by-provider on the free tier.
  const url = new URL(_req.url)
  const providerParam = url.searchParams.get("provider") as
    | "stripe" | "razorpay" | "cashfree" | "google_play" | "app_store" | null
  // Optional ?run_id=<uuid> — when the dashboard opens the live sync dialog it
  // pre-generates a run id, subscribes to sync_events for it, THEN fires the
  // per-provider sync requests (all sharing this run id) so the dialog streams
  // every provider's start + result live.
  const runId = url.searchParams.get("run_id") ?? undefined

  // Load the product + its per-currency pricing so the sync helpers have the
  // full inputs (the same shape the create/update routes pass through).
  const { data: product, error } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, display_name, store_description, interval, base_price_cents, base_currency, trial_enabled, trial_duration_days, trial_per_platform, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency, play_product_id, app_store_product_id",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", params.id)
    .single()
  if (error || !product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  const { data: pricing = [] } = await supabase
    .from("tenant_pricing")
    .select("currency, amount_cents")
    .eq("tenant_id", tenant.id)
    .eq("product_id", params.id)

  const body = {
    ...product,
    pricing_rows: (pricing ?? []).map((r: any) => ({
      currency: r.currency,
      amount_cents: r.amount_cents,
    })),
  }

  // One orchestrator does the fan-out, classification, AND durable sync_state
  // recording (marks `syncing` first, so a tab-close mid-run stays retryable).
  const summary = await runProductSync(supabase, {
    tenantId: tenant.id,
    productId: params.id,
    body,
    runId,
    productName: product.display_name ?? product.sku,
    onlyProvider: providerParam ?? undefined,
    existingStripeProductId: product.stripe_product_id ?? undefined,
    existingPrices: product.stripe_price_id_by_currency ?? undefined,
    existingRazorpayPlanIds: product.razorpay_plan_id_by_currency ?? undefined,
    existingPlayProductId: product.play_product_id ?? undefined,
    existingAppStoreProductId: product.app_store_product_id ?? undefined,
  })

  // Map the rich per-provider entry to the { status, message } shape the sync
  // UI renders. `synced`/`draft` → "ok" (draft keeps its message so the DRAFT
  // caveat still shows); `failed`/`skipped` keep their reason as the message so
  // the operator always sees WHY a provider didn't fully succeed.
  const toReport = (e: ProviderSyncEntry): { status: "ok" | "failed" | "skipped"; message?: string } => ({
    status: e.status === "failed" ? "failed" : e.status === "skipped" ? "skipped" : "ok",
    message: e.reason,
  })
  // Build from whatever providers actually ran — per-provider mode returns just
  // one, so hardcoding all five would dereference `undefined` and 500.
  const reports: Record<string, { status: "ok" | "failed" | "skipped"; message?: string }> = {}
  for (const [name, entry] of Object.entries(summary.providers)) {
    reports[name] = toReport(entry)
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.sync",
    p_resource: `tenant_products:id=${params.id}`,
    p_after: { sku: product.sku, sync_status: summary.status, ...reports },
  })

  return NextResponse.json(reports)
}