import { NextResponse } from "next/server"
import type { createClient } from "@/lib/supabase-server"

/**
 * Save a PSP credential onto the provider ACCOUNT and attach this app.
 *
 * The three PSP key routes (Stripe, Razorpay, Cashfree) each carried the same create-vs-update
 * branch against `tenant_providers_save_keys` / `tenant_providers_update_keys`, writing the
 * credential onto the app's own `tenant_providers` row. Migration 112 moved PSP credentials to the
 * account tier, so those writes landed where the read path no longer looks first: an operator would
 * save a key, see "saved", and the resolver would keep returning whatever the account held.
 *
 * One helper rather than the same edit three times — the shared-credential guard and the 409
 * contract are the kind of thing that drifts immediately when it is copy-pasted, and the three
 * providers have no reason to differ here.
 *
 * The create/update branch DISAPPEARS: `tenant_psp_account_save` merges over the existing credential
 * document, treating a blank field as "unchanged". That is what the two old RPCs were approximating
 * with a branch, and the merge is the honest expression of it — a partial edit of the live keys no
 * longer has to pretend to be a full save.
 */

export interface PspKeys {
  test_key_id: string
  test_secret: string
  test_webhook_secret: string
  live_key_id: string
  live_secret: string
  live_webhook_secret: string
}

export interface PspSaveOptions {
  /** Target a SPECIFIC connection; null = the one this app already resolves to. */
  accountId?: string | null
  /** Insert a NEW connection instead of resolving to an existing one. */
  createNew?: boolean
  /** Permit replacing a credential more than one app bills through. */
  confirmShared?: boolean
  /** Operator-chosen name for the connection; falls back to the key id in the RPC. */
  label?: string
}

export async function savePspAccount(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  provider: string,
  keys: PspKeys,
  opts: PspSaveOptions = {},
): Promise<NextResponse> {
  const { data: accountId, error } = await supabase.rpc("tenant_psp_account_save", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_label: opts.label ?? "",
    p_test_key_id: keys.test_key_id ?? "",
    p_test_secret: keys.test_secret ?? "",
    p_test_webhook_secret: keys.test_webhook_secret ?? "",
    p_live_key_id: keys.live_key_id ?? "",
    p_live_secret: keys.live_secret ?? "",
    p_live_webhook_secret: keys.live_webhook_secret ?? "",
    p_account_id: opts.accountId ?? null,
    p_create_new: opts.createNew === true,
    p_confirm_shared: opts.confirmShared === true,
  })

  if (error) {
    // Not a failure — a question only the operator can answer. Replacing a key that N apps bill
    // through is a legitimate rotation and a catastrophic accident, and the payload is identical
    // either way, so it becomes a 409 carrying the count.
    const shared = /shared_credential_in_use:(\d+)/.exec(error.message)
    if (shared) {
      return NextResponse.json(
        { error: "shared_credential_in_use", appsUsing: Number(shared[1]), requiresConfirmation: true },
        { status: 409 },
      )
    }
    if (error.message.includes("credential_required_for_new_connection")) {
      return NextResponse.json({ error: "A new connection needs its own secret key." }, { status: 400 })
    }
    if (error.message.includes("forbidden_connection") || error.message.includes("unknown_connection")) {
      return NextResponse.json({ error: "That connection is not yours to edit." }, { status: 403 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode: opts.createNew ? "create-new" : "saved", accountId })
}
