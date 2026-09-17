export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { razorpayRest } from "@/lib/razorpay-rest"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { savePspAccount } from "@/lib/psp-account-save"

/**
 * Razorpay manual API keys flow — mirrors the Stripe Manual keys route.
 *
 * First save: test keys required, live optional. When live is empty we echo
 * test → live so the SDK has both slots populated; runtime mode detection
 * uses the `rzp_test_` / `rzp_live_` prefix so this echo is safe.
 *
 * Partial update: when a `tenant_providers` row already exists, missing
 * fields mean "keep existing". The merchant can swap just the webhook
 * secret without re-pasting key_id + key_secret.
 *
 * Validation: each provided key_secret is checked against Razorpay's API
 * via `payments.all({count:1})` — a cheap auth probe. Bad keys 401 from
 * Razorpay, surface as a 400 with the underlying message.
 */

interface SaveBody {
  test_key_id: string
  test_key_secret: string
  test_webhook_secret: string
  live_key_id: string
  live_key_secret: string
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
 * Persist a non-secret "which account is this?" label. tenant_providers is
 * service-role-write-only under RLS, so the label goes through the tenant-admin
 * guarded RPC (migration 086). Best-effort — never fails the key save.
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

async function validateKeyPair(
  keyId: string,
  keySecret: string,
  mode: "test" | "live",
): Promise<string | null> {
  const prefix = mode === "test" ? "rzp_test_" : "rzp_live_"
  if (!keyId.startsWith(prefix)) {
    return `${mode}_key_id must start with ${prefix}`
  }
  try {
    const client = razorpayRest(keyId, keySecret)
    await client.payments.all({ count: 1 })
    return null
  } catch (e: any) {
    return `${mode} key invalid: ${e.message ?? "auth failed"}`
  }
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<SaveBody>
  const supabase = createClient()

  // First-save vs partial-update branch.
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("test_key_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "razorpay")
    .maybeSingle()
  const isUpdate = !!existing

  const t = (s: string | undefined) => (s && s.trim() ? s.trim() : "")
  const test_pk = t(body.test_key_id)
  const test_sk = t(body.test_key_secret)
  const test_wh = t(body.test_webhook_secret)
  const live_pk = t(body.live_key_id)
  const live_sk = t(body.live_key_secret)
  const live_wh = t(body.live_webhook_secret)

  // Live slot is "actually provided" only when distinct from test (the form
  // echoes blank when "Also configure live keys" is off).
  const liveProvided = !!live_pk && (live_pk !== test_pk || live_sk !== test_sk)

  // Validate every key pair the operator typed.
  const errors: string[] = []
  if (test_pk && test_sk) {
    const e = await validateKeyPair(test_pk, test_sk, "test")
    if (e) errors.push(e)
  } else if (!isUpdate) {
    errors.push("test_key_id + test_key_secret required for first-time save")
  }
  if (liveProvided && live_pk && live_sk) {
    const e = await validateKeyPair(live_pk, live_sk, "live")
    if (e) errors.push(e)
  }
  if (!isUpdate && !test_wh) {
    errors.push("test_webhook_secret required for first-time save")
  }

  if (errors.length) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 })
  }


  // Initial save — RPC needs all six fields. Echo test → live when the
  // operator hasn't filled in a separate live set yet.
  // ONE call: the account-tier RPC merges over the existing credential document, so a blank field
  // means "unchanged" and the old create-vs-update branch is no longer needed. `liveProvided`
  // still decides whether the live slots carry real values or echo the test ones.
  return savePspAccount(
    supabase,
    tenant.id,
    "razorpay",
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