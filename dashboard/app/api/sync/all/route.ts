import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { DRIFT_DETECTORS, type DriftFinding } from "@/lib/drift-detectors"
import { loadProductSyncBody, runProductSync } from "@/lib/stripe-route-helper"

/**
 * POST /api/sync/all — drain everything that diverged.
 *
 * This BULK-WRITES to live providers, so it is gated on a count the caller must have seen. The
 * client reads /api/sync/drift, shows the operator N findings, and echoes N back as `confirm_count`.
 * A mismatch means the world changed between looking and acting — which is exactly when a bulk write
 * to a billing provider should stop and ask again rather than proceed on stale intent.
 *
 * The shape is borrowed from provider-connections-manager's shared-credential delete, which returns
 * a 409 carrying the count so a refusal reads as an instruction rather than a wall.
 */

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string
    confirm_count?: number
  }
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id is required" }, { status: 400 })

  const findings: DriftFinding[] = []
  for (const detect of DRIFT_DETECTORS) {
    try {
      findings.push(...(await detect(supabase, body.tenant_id)))
    } catch {
      // A detector that cannot run means we do not know the true count — refuse rather than drain a
      // partial set, because the operator confirmed a number this would no longer match.
      return NextResponse.json(
        { error: "drift_incomplete", detail: "a provider was unreachable; re-run the drift report" },
        { status: 503 },
      )
    }
  }

  if (typeof body.confirm_count !== "number" || body.confirm_count !== findings.length) {
    return NextResponse.json(
      {
        error: "count_mismatch",
        expected: findings.length,
        received: body.confirm_count ?? null,
        detail: `The drift set changed — ${findings.length} item(s) now need attention. Re-read the report and confirm again.`,
        requiresConfirmation: true,
      },
      { status: 409 },
    )
  }

  // Only product drift is drainable by a bulk sync. The other classes need a human decision — a
  // missing live credential, an unpublished paywall the merchant may be mid-edit on, a price that
  // nobody has decided yet. Draining those automatically would make choices that are not ours.
  // Only findings carrying a row id are drainable; a shared-package finding names several SKUs and
  // has no single product to re-sync, so it belongs in needs_human rather than being half-applied.
  const syncable = findings.filter((f) => f.kind === "product-missing-at-provider" && f.subject_id)
  const results: Array<{ subject: string; ok: boolean; detail?: string }> = []
  for (const f of syncable) {
    try {
      const loaded = await loadProductSyncBody(supabase, body.tenant_id, f.subject_id!)
      if (!loaded) {
        results.push({ subject: f.subject, ok: false, detail: "product row disappeared mid-drain" })
        continue
      }
      await runProductSync(supabase, {
        tenantId: body.tenant_id,
        productId: f.subject_id!,
        body: loaded.body,
        productName: loaded.product.display_name ?? loaded.product.sku,
        existingStripeProductId: loaded.product.stripe_product_id ?? undefined,
        existingPrices: loaded.product.stripe_price_id_by_currency ?? undefined,
        existingRazorpayPlanIds: loaded.product.razorpay_plan_id_by_currency ?? undefined,
        existingPlayProductId: loaded.product.play_product_id ?? undefined,
        existingAppStoreProductId: loaded.product.app_store_product_id ?? undefined,
      })
      results.push({ subject: f.subject, ok: true })
    } catch (e) {
      results.push({ subject: f.subject, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({
    ok: true,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    needs_human: findings.filter((f) => f.kind !== "product-missing-at-provider" || !f.subject_id),
  })
}
