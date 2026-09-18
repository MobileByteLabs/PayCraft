import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { DRIFT_DETECTORS, type DriftFinding } from "@/lib/drift-detectors"
import { loadProductSyncBody, runProductSync } from "@/lib/stripe-route-helper"
import { logRequest, newRunId } from "@/lib/request-log"

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
  if (!auth?.user) {
    // Logged, not silently rejected: an unauthenticated call is the one you most need a record of,
    // and an empty log during a 401 storm looks identical to no traffic at all.
    await logRequest(supabase, {
      route: "/api/sync/all",
      method: "POST",
      status: 401,
      error: "not_authenticated",
    })
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string
    confirm_count?: number
  }
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id is required" }, { status: 400 })

  // One correlation id for the whole drain. runProductSync only emits sync_events when given a
  // runId, and no drain ever passed one — so the table that exists to explain a sync held
  // nothing for any drain, and every failure had to be reconstructed from state afterwards.
  const runId = newRunId()
  const startedAt = Date.now()

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
  // EXCEPTION to the paragraph above, and only because the default is now DECLARED policy: a
  // provider-served locale with no price row gets one at the product's base amount in USD. It was
  // previously "a price nobody has decided", which is why it sat in needs_human forever — the
  // finding's only remedy was a manual per-product, per-country edit.
  //
  // This is safe to automate because the row is written source='fallback', so it can never
  // masquerade as a merchant's deliberate price: an audit can still answer "did anyone choose this
  // number?" with no. It is also insert-only, so a real price is never overwritten.
  const servedLocaleFindings = findings.filter((f) => f.kind === "missing-currency-for-country")
  let pricedLocales = 0
  if (servedLocaleFindings.length > 0) {
    const { data: seeded, error: seedErr } = await supabase.rpc("tenant_pricing_ensure_served_locales", {
      p_tenant_id: body.tenant_id,
      p_default_currency: "USD",
    })
    if (seedErr) {
      // Surfaced, never swallowed — a silent failure here re-appears next run as the same finding
      // with no explanation, which is how an operator learns to ignore the report.
      return NextResponse.json(
        { error: "pricing_seed_failed", detail: seedErr.message },
        { status: 500 },
      )
    }
    pricedLocales = (seeded as unknown[] | null)?.length ?? 0
  }

  // A connected provider with ZERO checkout links is drainable too, and its own action_hint has
  // always said so — "Sync products to <provider> (POST /api/sync/all)". It was not: the filter
  // below only accepted product-missing-at-provider, so the drain reported "Synced 0 item(s)" and
  // the finding survived every press. A hint that names a button which cannot fix it is worse than
  // no hint — the operator concludes the feature is broken.
  //
  // The fix is scoped, not a blanket re-sync: runProductSync takes onlyProvider, so this pushes
  // every active product to THAT provider alone and leaves the others untouched.
  const zeroLinkProviders = [
    ...new Set(
      findings
        .filter((f) => f.kind === "active-provider-zero-links")
        .map((f) => f.subject.replace(/^provider:/, "")),
    ),
  ].filter((p): p is "stripe" | "razorpay" | "cashfree" | "google_play" | "app_store" =>
    ["stripe", "razorpay", "cashfree", "google_play", "app_store"].includes(p),
  )

  const syncable = findings.filter((f) => f.kind === "product-missing-at-provider" && f.subject_id)
  // `skipped` is its own outcome, NOT a success. runProductSync records a per-provider verdict in
  // tenant_products.sync_state; a provider it could not use writes status='skipped' with a reason
  // and the call still resolves. Counting that as ok is what produced "Synced 3 item(s)" for three
  // products where every razorpay push was skipped.
  const results: Array<{ subject: string; ok: boolean; skipped?: boolean; detail?: string }> = []

  /** Read back what runProductSync actually recorded for this provider. */
  async function providerVerdict(productId: string, provider: string) {
    const { data } = await supabase
      .from("tenant_products")
      .select("sync_state")
      .eq("id", productId)
      .single<{ sync_state: Record<string, { status?: string; error?: string; reason?: string }> | null }>()
    const s = data?.sync_state?.[provider]
    return {
      status: s?.status ?? "unknown",
      detail: s?.reason ?? s?.error ?? undefined,
    }
  }
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
        runId,
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

  // Provider-scoped drain for the zero-links class.
  for (const provider of zeroLinkProviders) {
    const { data: prods } = await supabase
      .from("tenant_products")
      .select("id")
      .eq("tenant_id", body.tenant_id)
      .eq("active", true)
    for (const row of prods ?? []) {
      try {
        const loaded = await loadProductSyncBody(supabase, body.tenant_id, row.id as string)
        if (!loaded) continue
        await runProductSync(supabase, {
          tenantId: body.tenant_id,
          productId: row.id as string,
          body: loaded.body,
          productName: loaded.product.display_name ?? loaded.product.sku,
          runId,
          onlyProvider: provider,
          existingStripeProductId: loaded.product.stripe_product_id ?? undefined,
          existingPrices: loaded.product.stripe_price_id_by_currency ?? undefined,
          existingRazorpayPlanIds: loaded.product.razorpay_plan_id_by_currency ?? undefined,
          existingPlayProductId: loaded.product.play_product_id ?? undefined,
          existingAppStoreProductId: loaded.product.app_store_product_id ?? undefined,
        })
        const v = await providerVerdict(row.id as string, provider)
        results.push({
          subject: `provider:${provider}/${loaded.product.sku}`,
          ok: v.status === "synced" || v.status === "ok",
          skipped: v.status === "skipped",
          detail: v.status === "synced" || v.status === "ok" ? undefined : `${v.status}${v.detail ? ` — ${v.detail}` : ""}`,
        })
      } catch (e) {
        results.push({
          subject: `provider:${provider}/${row.id}`,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  const payload = {
    ok: true,
    synced: results.filter((r) => r.ok).length,
    priced_locales: pricedLocales,
    skipped: results.filter((r) => r.skipped),
    failed: results.filter((r) => !r.ok && !r.skipped),
    needs_human: findings.filter(
      (f) =>
        f.kind !== "missing-currency-for-country" &&
        f.kind !== "active-provider-zero-links" &&
        (f.kind !== "product-missing-at-provider" || !f.subject_id),
    ),
    run_id: runId,
  }

  // The outcome, not just the status code. This is the line that would have shown "synced 0,
  // skipped 3" at the moment it happened, instead of leaving it to be inferred from sync_state.
  await logRequest(supabase, {
    route: "/api/sync/all",
    method: "POST",
    tenantId: body.tenant_id,
    status: 200,
    durationMs: Date.now() - startedAt,
    runId,
    params: { confirm_count: body.confirm_count, findings: findings.length, zero_link_providers: zeroLinkProviders },
    result: {
      synced: payload.synced,
      priced_locales: payload.priced_locales,
      skipped: payload.skipped.map((r) => ({ subject: r.subject, detail: r.detail })),
      failed: payload.failed.map((r) => ({ subject: r.subject, detail: r.detail })),
      needs_human: payload.needs_human.map((f) => f.kind),
    },
  })

  return NextResponse.json(payload)
}
