export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { randomHex } from "@/lib/edge-crypto"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerSupabase } from "@/lib/supabase-server"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  const { app_name } = await req.json()
  if (!app_name || typeof app_name !== "string") {
    return NextResponse.json(
      { error: "app_name required" },
      { status: 400 },
    )
  }

  const supabase = createServerSupabase()
  // SECURITY: getUser() revalidates the JWT against the Auth server on every call.
  // getSession() only decodes the cookie without revalidation and must NOT gate a
  // mutating/authorization decision (Supabase SSR guidance).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = user.id
  const email = user.email!

  // Use the service-role client to bypass RLS for tenant insert
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const apiKeyTest = "pk_test_" + randomHex(24)
  const apiKeyLive = "pk_live_" + randomHex(24)
  const webhookSecretTest = "whsec_test_" + randomHex(24)
  const webhookSecretLive = "whsec_live_" + randomHex(24)

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({
      name: app_name,
      api_key_test: apiKeyTest,
      api_key_live: apiKeyLive,
      webhook_secret_test: webhookSecretTest,
      webhook_secret_live: webhookSecretLive,
      plan: "free",
      subscriber_limit: 100,
      owner_email: email,
    })
    .select("id,api_key_test,api_key_live")
    .single()

  if (tenantErr || !tenant) {
    return NextResponse.json(
      { error: tenantErr?.message ?? "could not create tenant" },
      { status: 500 },
    )
  }

  // Link user as owner
  await admin.from("tenant_admins").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  })

  // Refresh entitlements
  await admin.rpc("refresh_tenant_entitlements", { p_tenant_id: tenant.id })

  // Seed default paywall
  await admin.rpc("tenant_paywall_ensure_default", {
    p_tenant_id: tenant.id,
  })

  // Seed default platform routing: a primary AND a fallback per platform. This path inserts the
  // tenant directly instead of calling provision_app, so it does not inherit the defaults that RPC
  // now seeds — without this line an app onboarded here would have no fallback, and the first buyer
  // its primary cannot serve would resolve no provider at all.
  await admin.rpc("tenant_routing_apply_defaults", { p_tenant_id: tenant.id })

  await admin.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "tenant.created",
    p_resource: `tenants:id=${tenant.id}`,
    p_after: { name: app_name },
  })

  return NextResponse.json(tenant)
}