export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { savePspAccount } from "@/lib/psp-account-save"

/**
 * Cashfree credentials persistence — same shape as the Stripe / Razorpay
 * Manual API keys flow. Saves onto the provider ACCOUNT via `tenant_psp_account_save` (112) so one
 * Cashfree account can serve many apps, keeping the credentials in the same
 * encrypted-at-rest table as the other providers.
 *
 * Validation here is lighter than Stripe's: Cashfree doesn't publish a
 * trivial "balance/ping" endpoint we can call as a cheap auth probe, so we
 * just sanity-check non-empty + format. Bad keys will surface at first
 * payment-link create instead.
 */
interface Body {
  test_app_id: string
  test_secret_key: string
  test_webhook_secret: string
  live_app_id: string
  live_secret_key: string
  live_webhook_secret: string
  account_label: string
  /** Target a SPECIFIC connection; null/absent = the one this app already resolves to. */
  account_id: string | null
  /** Insert a NEW connection instead of resolving to an existing one. */
  create_new: boolean
  /** Permit replacing a credential more than one app bills through. */
  confirm_shared_overwrite: boolean
}

/**
 * Persist a non-secret "which account is this?" label via the tenant-admin
 * guarded RPC (migration 086). Best-effort; never fails the key save.
 */
async function saveAccountLabel(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  provider: string,
  label: string,
) {
  const l = (label ?? "").trim()
  if (!l) return
  await supabase.rpc("tenant_providers_set_account_label", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_label: l,
  })
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<Body>
  const supabase = createClient()

  const t = (s: string | undefined) => (s && s.trim() ? s.trim() : "")
  const test_pk = t(body.test_app_id)
  const test_sk = t(body.test_secret_key)
  const test_wh = t(body.test_webhook_secret)
  const live_pk = t(body.live_app_id)
  const live_sk = t(body.live_secret_key)
  const live_wh = t(body.live_webhook_secret)

  // Detect first save vs partial update — same pattern as the Stripe keys
  // route. When existing row is present, NULL params on the update RPC
  // mean "keep existing".
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("test_key_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "cashfree")
    .maybeSingle()
  const isUpdate = !!existing

  if (!isUpdate) {
    if (!test_pk || !test_sk) {
      return NextResponse.json(
        { error: "test_app_id + test_secret_key required for first-time save" },
        { status: 400 },
      )
    }
  }
  // Live keys only count as "provided" when distinct from test (the form
  // echoes blank when "Also configure live keys" is off).
  const liveProvided = !!live_pk && live_pk !== test_pk


  // ONE call: the account-tier RPC merges over the existing credential document, so a blank field
  // means "unchanged" and the old create-vs-update branch is no longer needed. `liveProvided`
  // still decides whether the live slots carry real values or echo the test ones.
  return savePspAccount(
    supabase,
    tenant.id,
    "cashfree",
    {
      test_key_id: test_pk,
      test_secret: test_sk,
      test_webhook_secret: test_wh,
      live_key_id: liveProvided ? live_pk : test_pk,
      live_secret: liveProvided ? live_sk : test_sk,
      live_webhook_secret: liveProvided ? live_wh : test_wh,
    },
    {
      label: body.account_label ?? "",
      accountId: body.account_id ?? null,
      createNew: body.create_new === true,
      confirmShared: body.confirm_shared_overwrite === true,
    },
  )
}