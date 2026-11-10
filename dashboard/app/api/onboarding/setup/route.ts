export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { skuFor } from "@/lib/sku"
import { randomHex } from "@/lib/edge-crypto"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerSupabase } from "@/lib/supabase-server"
import { checkEdgeRateLimit, extractIp, rateLimitHeaders } from "@/lib/edge-rate-limit"
import { runProductSync } from "@/lib/stripe-route-helper"

/**
 * POST /api/onboarding/setup — one-call, secured, idempotent app onboarding.
 *
 * Provisions a new app under the CALLER's PayCraft account end-to-end: creates
 * (or reuses) the caller-owned tenant, optionally inherits the account's existing
 * provider connections, seeds the four default subscription tiers, and best-effort
 * syncs them to the connected providers.
 *
 * SECURITY (this endpoint mutates billing + copies provider credentials):
 *  - Auth via getUser() (JWT revalidated), never getSession().
 *  - Own-account scoping: the tenant is always owned by the caller; provider
 *    inheritance REQUIRES the caller to own the source tenant (tenant_admins),
 *    so it can never copy another account's provider credentials.
 *  - IP rate-limited.
 *  - Provider secret ciphertext is copied server-side (global-key encrypted) and
 *    NEVER decrypted or returned; only the caller's OWN api keys (needed to
 *    integrate the SDK) are returned.
 *  - All writes go through the service-role client server-side; every run is
 *    audit-logged.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const DEFAULT_TIERS = [
  { interval: "month", cents: 999, order: 1 },
  { interval: "quarter", cents: 2847, order: 2 },
  { interval: "semiannual", cents: 5395, order: 3 },
  { interval: "year", cents: 9950, order: 4 },
]
const WEB_PSP = new Set(["stripe", "razorpay", "cashfree"])
const NATIVE = new Set(["google_play", "app_store"])

export async function POST(req: NextRequest) {
  // 1. Rate limit (IP).
  const rl = checkEdgeRateLimit(extractIp(req.headers))
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: rateLimitHeaders(rl) })
  }

  // 2. Auth — revalidated user (never getSession for an authorization decision).
  const supabase = createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 })
  }
  const userId = user.id
  const email = user.email

  // 3. Validate input.
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const appName = typeof raw.app_name === "string" ? raw.app_name.trim() : ""
  if (!appName || appName.length > 120) {
    return NextResponse.json({ error: "app_name required (<=120 chars)" }, { status: 400 })
  }
  const packageName = typeof raw.package_name === "string" ? raw.package_name.trim() || null : null
  const bundleId = typeof raw.bundle_id === "string" ? raw.bundle_id.trim() || null : packageName
  const platforms = Array.isArray(raw.platforms) ? (raw.platforms as unknown[]).filter((p) => typeof p === "string") as string[] : []
  const inheritFrom = typeof raw.inherit_providers_from === "string" ? raw.inherit_providers_from : null
  // Optional subset of provider names to inherit (checkboxes). null = inherit all.
  const inheritOnly = Array.isArray(raw.inherit_providers)
    ? ((raw.inherit_providers as unknown[]).filter((p) => typeof p === "string") as string[])
    : null
  const seedProducts = raw.seed_products !== false
  const doSync = raw.sync !== false

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 4. Create or reuse THIS caller's tenant by (owner_email, name).
  let tenant = (
    await admin.from("tenants").select("id,api_key_test,api_key_live").eq("owner_email", email).eq("name", appName).maybeSingle()
  ).data
  let created = false
  if (!tenant) {
    const ins = await admin
      .from("tenants")
      .insert({
        name: appName,
        api_key_test: "pk_test_" + randomHex(24),
        api_key_live: "pk_live_" + randomHex(24),
        webhook_secret_test: "whsec_test_" + randomHex(24),
        webhook_secret_live: "whsec_live_" + randomHex(24),
        plan: "free",
        subscriber_limit: 100,
        owner_email: email,
      })
      .select("id,api_key_test,api_key_live")
      .single()
    if (ins.error || !ins.data) {
      return NextResponse.json({ error: ins.error?.message ?? "could_not_create_tenant" }, { status: 500 })
    }
    tenant = ins.data
    created = true
    await admin.from("tenant_admins").insert({ tenant_id: tenant.id, user_id: userId, role: "owner" })
    await admin.rpc("refresh_tenant_entitlements", { p_tenant_id: tenant.id })
    await admin.rpc("tenant_paywall_ensure_default", { p_tenant_id: tenant.id })
  }
  const tenantId = tenant.id as string

  // 5. Inherit providers — only from a source tenant the CALLER OWNS.
  const providersInherited: string[] = []
  if (inheritFrom && inheritFrom !== tenantId) {
    const owns = (
      await admin.from("tenant_admins").select("tenant_id").eq("tenant_id", inheritFrom).eq("user_id", userId).maybeSingle()
    ).data
    if (!owns) {
      return NextResponse.json({ error: "forbidden: caller does not own inherit_providers_from tenant" }, { status: 403 })
    }
    const src = (await admin.from("tenant_providers").select("*").eq("tenant_id", inheritFrom)).data ?? []
    for (const p of src as Record<string, unknown>[]) {
      const provider = p.provider as string
      if (inheritOnly && !inheritOnly.includes(provider)) continue // only the checked providers
      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        provider,
        is_active: p.is_active,
        supported_locales: p.supported_locales,
      }
      if (WEB_PSP.has(provider)) {
        // Web-PSP key ciphertext is global-key encrypted → copyable as-is.
        // Payment links are app/product-specific and are regenerated by sync.
        row.test_secret_key_enc = p.test_secret_key_enc
        row.live_secret_key_enc = p.live_secret_key_enc
        row.test_webhook_secret_enc = p.test_webhook_secret_enc
        row.live_webhook_secret_enc = p.live_webhook_secret_enc
        row.test_key_id = p.test_key_id
        row.live_key_id = p.live_key_id
        // store_config holds only the non-secret account_label for web PSPs (no
        // app-specific ids) — carry it so the adopted app references the same
        // account in the dashboard / reuse picker.
        if (p.store_config) row.store_config = p.store_config
      } else if (NATIVE.has(provider)) {
        // Same store service-account/.p8 credential, but the store_config app ids
        // MUST be THIS app's (package_name / bundle_id).
        row.store_credential_enc = p.store_credential_enc
        const cfg: Record<string, unknown> = { ...((p.store_config as Record<string, unknown>) ?? {}) }
        if (provider === "google_play" && packageName) cfg.package_name = packageName
        if (provider === "app_store" && (bundleId ?? packageName)) cfg.bundle_id = bundleId ?? packageName
        row.store_config = cfg
      } else {
        continue
      }
      await admin.from("tenant_providers").upsert(row, { onConflict: "tenant_id,provider" })
      providersInherited.push(provider)
    }
  }

  // 6. Seed default subscription tiers (interval-idempotent). tenant_products_upsert
  //    is allowed for the trusted backend (migration 084).
  const productsSeeded: string[] = []
  if (seedProducts) {
    for (const t of DEFAULT_TIERS) {
      const has = (
        await admin.from("tenant_products").select("id").eq("tenant_id", tenantId).eq("type", "subscription").eq("interval", t.interval).maybeSingle()
      ).data
      if (has) continue
      // The SKU follows the naming convention (migration 179, lib/sku.ts); the STORE product id keeps the
      // reverse-DNS shape the stores expect, in its own columns — they were the same string before.
      const sku = skuFor("pro", t.interval)
      const storeId = `${packageName ?? appName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.sub.${t.interval}`
      const { error } = await admin.rpc("tenant_products_upsert", {
        p_row: {
          tenant_id: tenantId,
          sku,
          type: "subscription",
          display_name: `${appName} ${t.interval}`,
          interval: t.interval,
          base_price_cents: t.cents,
          base_currency: "USD",
          display_order: t.order,
          active: true,
          pricing_mode: "auto",
          play_product_id: platforms.includes("android") ? storeId : null,
          app_store_product_id: platforms.includes("ios") ? storeId : null,
        },
      })
      if (!error) productsSeeded.push(sku)
    }
  }

  // 7. Best-effort sync to connected providers. NOTE: syncing every product to
  //    every provider inline can exceed Cloudflare's per-invocation subrequest
  //    cap, so each product is synced independently and failures are reported (the
  //    caller can re-drive a failed product via POST /api/products/{id}/sync).
  let sync: { product_id: string; ok: boolean; error?: string }[] | null = null
  if (doSync && (providersInherited.length > 0)) {
    const prods = (await admin.from("tenant_products").select("*").eq("tenant_id", tenantId).eq("type", "subscription")).data ?? []
    sync = []
    for (const p of prods as Record<string, unknown>[]) {
      try {
        await runProductSync(admin as never, { tenantId, productId: p.id as string, body: p as never })
        sync.push({ product_id: p.id as string, ok: true })
      } catch (e) {
        sync.push({ product_id: p.id as string, ok: false, error: (e as Error)?.message ?? "sync_failed" })
      }
    }
  }

  // 8. Audit.
  await admin.rpc("audit_log_emit", {
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: created ? "tenant.onboarded" : "tenant.reconciled",
    p_resource: `tenants:id=${tenantId}`,
    p_after: { app_name: appName, providers_inherited: providersInherited, products_seeded: productsSeeded.length },
  })

  return NextResponse.json(
    {
      tenant_id: tenantId,
      created,
      // The caller's OWN api keys (needed to init the SDK) — not a provider secret.
      api_key_test: tenant.api_key_test,
      api_key_live: tenant.api_key_live,
      providers_inherited: providersInherited,
      products_seeded: productsSeeded,
      sync,
    },
    { headers: rateLimitHeaders(rl) },
  )
}
