export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * App Store Connect store credentials persistence — mirrors the Google Play
 * store keys route. Stores a SINGLE .p8 private-key blob (encrypted) plus the
 * non-secret key id / issuer id / bundle id via
 * `tenant_providers_save_store_keys`.
 *
 * Body: { p8_key?: string, key_id?: string, issuer_id?: string, bundle_id?: string }
 *   - p8_key: the whole App Store Connect API private key (.p8 PEM). Empty on a
 *     partial update keeps the existing encrypted blob.
 *   - key_id / issuer_id / bundle_id: non-secret identifiers.
 *
 * The secret VALUE is NEVER echoed back — only { ok, mode } is returned.
 */
interface Body {
  p8_key: string
  key_id: string
  issuer_id: string
  bundle_id: string
  account_label: string
  /** Update a SPECIFIC connection; null/absent = the one this app already resolves to. */
  account_id: string | null
  /** Insert a NEW connection instead of resolving to an existing one ("connect another account"). */
  create_new: boolean
  /** Permit replacing a credential that more than one app depends on. */
  confirm_shared_overwrite: boolean
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<Body>
  const supabase = createClient()

  const p8 = (body.p8_key ?? "").trim()
  const keyId = (body.key_id ?? "").trim()
  const issuerId = (body.issuer_id ?? "").trim()
  const bundleId = (body.bundle_id ?? "").trim()
  // A non-secret "which Apple account is this?" label (e.g. the team's email).
  const accountLabel = (body.account_label ?? "").trim()

  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("store_credential_enc, store_config, provider_account_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "app_store")
    .maybeSingle()
  // "Update" means this app already resolves to a credential — attached account OR legacy local
  // blob. Otherwise an account-attached app would be asked for the .p8 again to edit a bundle id.
  const isUpdate = !!existing && (!!existing.store_credential_enc || !!existing.provider_account_id)

  if (!keyId || !issuerId || !bundleId) {
    return NextResponse.json(
      { error: "key_id, issuer_id and bundle_id are all required" },
      { status: 400 },
    )
  }
  if (p8) {
    // Cheap sanity check — a real .p8 is a PKCS#8 PEM.
    if (!p8.includes("PRIVATE KEY")) {
      return NextResponse.json(
        { error: "p8_key does not look like a PKCS#8 PEM private-key block" },
        { status: 400 },
      )
    }
  } else if (!isUpdate) {
    return NextResponse.json(
      { error: "p8_key required for first-time save" },
      { status: 400 },
    )
  }

  const existingCfg = (existing?.store_config as Record<string, unknown> | null) ?? {}
  // Split by SCOPE. key_id + issuer_id identify the API KEY — one App Store Connect team serves
  // every app under it — while bundle_id identifies THIS app. Putting bundle_id on the account
  // would make every app sharing that team claim the same bundle.
  const acctConfig: Record<string, unknown> = { key_id: keyId, issuer_id: issuerId }
  const appConfig: Record<string, unknown> = { bundle_id: bundleId }

  // Preserve any prior label unless the operator typed a new one; else name the connection by its
  // key id, which is what distinguishes two teams in a list.
  const label = accountLabel || (existingCfg.account_label as string) || `App Store key ${keyId}`

  // Writes to the ACCOUNT, then attaches this app — the save side of the precedence migration 104
  // installed on the read side.
  const { data: accountId, error } = await supabase.rpc("tenant_store_account_save", {
    p_tenant_id: tenant.id,
    p_provider: "app_store",
    p_credential: p8 || "", // "" → keep existing blob on update
    p_label: label,
    p_acct_cfg: acctConfig,
    p_app_cfg: appConfig,
    p_account_id: body.account_id ?? null,
    p_create_new: body.create_new === true,
    p_confirm_shared: body.confirm_shared_overwrite === true,
  })
  if (error) {
    // `shared_credential_in_use:<n>` is not a failure — it is the RPC asking a question that only
    // the operator can answer, so it becomes a 409 carrying the count rather than a 500. Replacing
    // a key that N apps bill through is a legitimate rotation and a catastrophic accident, and the
    // payload looks identical either way.
    const m = /shared_credential_in_use:(\d+)/.exec(error.message)
    if (m) {
      return NextResponse.json(
        { error: "shared_credential_in_use", appsUsing: Number(m[1]), requiresConfirmation: true },
        { status: 409 },
      )
    }
    if (error.message.includes("credential_required_for_new_connection")) {
      return NextResponse.json({ error: "A new connection needs its own credential." }, { status: 400 })
    }
    if (error.message.includes("forbidden_connection") || error.message.includes("unknown_connection")) {
      return NextResponse.json({ error: "That connection is not yours to edit." }, { status: 403 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode: body.create_new ? "create-new" : isUpdate ? "update" : "create", accountId })
}