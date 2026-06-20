/**
 * dashboard/tests/global-setup.ts
 *
 * Playwright global setup: seed a test tenant + user into local Supabase,
 * mint a session, and persist auth cookies to tests/.auth/state.json so
 * every test worker starts already logged in.
 *
 * Safe to re-run — all inserts are idempotent (upsert / ON CONFLICT DO NOTHING).
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr"

// ── Fixed seed values (deterministic across runs) ────────────────────────────
const TEST_EMAIL = "pw-test@paycraft.local"
const TEST_PASSWORD = "Test1234!@#"
const TEST_TENANT_ID = "00000000-cafe-cafe-cafe-000000000001"
const TEST_API_KEY_TEST = "pk_test_playwright_seed_fixed_001"
const TEST_API_KEY_LIVE = "pk_live_playwright_seed_fixed_001"

// ── Resolve local Supabase credentials ───────────────────────────────────────
// global-setup runs in the Playwright process (NOT the spawned webServer), so it
// can't see webServer.env. Resolve the authoritative local keys straight from the
// CLI (`supabase status -o env`) at the project root (parent of dashboard/), then
// fall back to env vars.
function localSupabaseEnv(): Record<string, string> {
  try {
    const out = execSync("supabase status -o env", {
      cwd: path.resolve(process.cwd(), ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const env: Record<string, string> = {}
    for (const line of out.split("\n")) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
      if (m) env[m[1]] = m[2]
    }
    return env
  } catch {
    return {}
  }
}
const sb = localSupabaseEnv()
const SUPABASE_URL =
  sb.API_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON_KEY = sb.ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const SERVICE_KEY =
  sb.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

// ── Setup entry point ─────────────────────────────────────────────────────────
export default async function globalSetup(): Promise<void> {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anonClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 1. Seed auth user ───────────────────────────────────────────────────────
  let userId: string

  const { data: createData, error: createError } =
    await serviceClient.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })

  if (createError) {
    if (
      createError.message?.toLowerCase().includes("already") ||
      createError.message?.toLowerCase().includes("already registered") ||
      createError.message?.toLowerCase().includes("email already exists")
    ) {
      // User already exists — fetch the id
      const { data: listData, error: listError } =
        await serviceClient.auth.admin.listUsers()
      if (listError) throw new Error(`listUsers failed: ${listError.message}`)
      const existing = listData.users.find((u) => u.email === TEST_EMAIL)
      if (!existing) throw new Error(`User ${TEST_EMAIL} not found after create conflict`)
      userId = existing.id
    } else {
      throw new Error(`createUser failed: ${createError.message}`)
    }
  } else {
    userId = createData.user!.id
  }

  // ── 2. Seed tenant (service_role bypasses RLS) ──────────────────────────────
  // The tenants table has RLS "service_role only", so we must use the service
  // client directly (not via RPC that checks auth.uid()).
  const { error: tenantError } = await serviceClient
    .from("tenants")
    .upsert(
      {
        id: TEST_TENANT_ID,
        name: "Playwright Test App",
        api_key_test: TEST_API_KEY_TEST,
        api_key_live: TEST_API_KEY_LIVE,
        status: "active",
        plan: "pro",
        subscriber_limit: 1000,
        owner_email: TEST_EMAIL,
        // entitlements cached for fast canRemoveAttribution check
        entitlements: JSON.stringify([
          "multi_provider",
          "unlimited_subscribers",
          "remove_attribution",
          "analytics_90day",
          "team_size_unlimited",
        ]),
      },
      { onConflict: "id" },
    )
  if (tenantError) throw new Error(`tenant upsert failed: ${tenantError.message}`)

  // ── 3. Seed tenant_admins (composite unique: tenant_id + user_id) ───────────
  const { error: adminError } = await serviceClient
    .from("tenant_admins")
    .upsert(
      { tenant_id: TEST_TENANT_ID, user_id: userId, role: "owner" },
      { onConflict: "tenant_id,user_id" },
    )
  if (adminError) throw new Error(`tenant_admins upsert failed: ${adminError.message}`)

  // ── 4. Seed products (tenant_products unique: tenant_id + sku) ─────────────
  // Must match the columns the paywall page selects:
  //   id, sku, type, display_name, interval, base_price_cents, base_currency,
  //   display_order, trial_duration_days, attaches_to_product_id
  const products = [
    {
      id: "00000000-0d1e-0d1e-0d1e-000000000001",
      tenant_id: TEST_TENANT_ID,
      sku: "monthly",
      type: "subscription",
      display_name: "Monthly",
      interval: "month",
      base_price_cents: 199,
      base_currency: "USD",
      display_order: 0,
      active: true,
      trial_duration_days: null,
      attaches_to_product_id: null,
    },
    {
      id: "00000000-0d1e-0d1e-0d1e-000000000002",
      tenant_id: TEST_TENANT_ID,
      sku: "yearly",
      type: "subscription",
      display_name: "Yearly",
      interval: "year",
      base_price_cents: 1499,
      base_currency: "USD",
      display_order: 1,
      active: true,
      trial_duration_days: null,
      attaches_to_product_id: null,
    },
  ]

  const { error: productsError } = await serviceClient
    .from("tenant_products")
    .upsert(products, { onConflict: "tenant_id,sku" })
  if (productsError)
    throw new Error(`tenant_products upsert failed: ${productsError.message}`)

  // ── 5. Seed tenant_paywall via the RPC ────────────────────────────────────
  // The RPC checks tenant_admins for auth.uid() — but we need service_role
  // for the seed. Use a direct upsert instead (service_role bypasses RLS).
  // We need the tenant_paywall table's PK column. From migration 030 we know
  // it's keyed on tenant_id.
  const { error: paywallError } = await serviceClient
    .from("tenant_paywall")
    .upsert(
      {
        tenant_id: TEST_TENANT_ID,
        template: "branded-stack",
        theme_jsonb: {},
        branding: "attribution",
        custom_footer: null,
        primary_color: "#7C3AED",
        font_family: "Inter (default)",
        support_email: TEST_EMAIL,
        // v2 content fields
        hero_title: "Upgrade to Premium",
        hero_subtitle: "Ad-free. Unlimited. 4K Downloads.",
        value_props: [],
        cta_continue: "Continue",
        cta_get_premium: "Get Premium",
        restore_label: "Restore Your Premium",
        terms_url: null,
        privacy_url: null,
        popular_plan_sku: null,
        success_title: "Welcome to Premium!",
        success_message: "You now have access to all premium features.",
        success_cta_label: "Continue to app",
        hero_icon_svg: null,
        hero_icon_url: null,
      },
      { onConflict: "tenant_id" },
    )
  if (paywallError)
    throw new Error(`tenant_paywall upsert failed: ${paywallError.message}`)

  // ── 6. Mint session with anon client ─────────────────────────────────────────
  const { data: signInData, error: signInError } =
    await anonClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
  if (signInError || !signInData.session)
    throw new Error(`signInWithPassword failed: ${signInError?.message ?? "no session"}`)

  const { session } = signInData

  // ── 7. Capture auth cookies using @supabase/ssr cookie logic ─────────────────
  // createServerClient drives the canonical sb-*-auth-token cookie naming.
  // We don't need to guess cookie names — setSession() calls setAll() with
  // the correctly named cookie(s).
  type CollectedCookie = { name: string; value: string; options: CookieOptionsWithName }
  const collectedCookies: CollectedCookie[] = []

  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cs: CollectedCookie[]) => {
        collectedCookies.push(...cs)
      },
    },
  })

  const { error: setSessionError } = await ssrClient.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (setSessionError)
    throw new Error(`setSession failed: ${setSessionError.message}`)

  if (collectedCookies.length === 0) {
    throw new Error(
      "No cookies emitted by createServerClient.setSession — check @supabase/ssr version",
    )
  }

  // ── 8. Write Playwright storageState ────────────────────────────────────────
  const expiresAt = session.expires_at
    ? session.expires_at
    : Math.floor(Date.now() / 1000) + 86400

  const storageState = {
    cookies: collectedCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      expires: expiresAt,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
    origins: [],
  }

  const authDir = path.join(__dirname, ".auth")
  fs.mkdirSync(authDir, { recursive: true })
  fs.writeFileSync(path.join(authDir, "state.json"), JSON.stringify(storageState, null, 2))

  console.log(
    `[global-setup] Seeded tenant ${TEST_TENANT_ID}, user ${userId}, ` +
      `${collectedCookies.length} auth cookie(s) written to tests/.auth/state.json`,
  )
}
