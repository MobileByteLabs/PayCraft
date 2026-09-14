export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Google Play store credentials persistence — mirrors the Stripe / Cashfree
 * Manual keys route, but stores a SINGLE service-account JSON blob (encrypted)
 * plus the non-secret package name via `tenant_providers_save_store_keys`.
 *
 * Body: { service_account_json?: string, package_name?: string }
 *   - service_account_json: the whole SA JSON document (paste or file upload).
 *     Empty on a partial update keeps the existing encrypted blob.
 *   - package_name: the Android application id (com.example.app).
 *
 * The secret VALUE is NEVER echoed back — only { ok, mode } is returned.
 */
interface Body {
  service_account_json: string
  package_name: string
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

  const saJson = (body.service_account_json ?? "").trim()
  const packageName = (body.package_name ?? "").trim()

  // First-save vs partial-update branch — same detection as the PSP routes.
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("store_credential_enc, store_config, provider_account_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "google_play")
    .maybeSingle()
  // "Update" now means: this app already resolves to a credential, whether it lives on an attached
  // account or in the legacy app-local blob. Treating an account-attached app as a FIRST save would
  // demand the SA JSON again on a package-name-only edit.
  const isUpdate = !!existing && (!!existing.store_credential_enc || !!existing.provider_account_id)

  // Validate: on first save the SA JSON is required and must parse with the
  // fields the JWT-bearer grant needs. package_name is always required.
  if (!packageName) {
    return NextResponse.json({ error: "package_name is required" }, { status: 400 })
  }
  if (saJson) {
    try {
      const parsed = JSON.parse(saJson) as { client_email?: string; private_key?: string }
      if (!parsed.client_email || !parsed.private_key) {
        return NextResponse.json(
          { error: "service_account_json must contain client_email and private_key" },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: "service_account_json is not valid JSON" },
        { status: 400 },
      )
    }
  } else if (!isUpdate) {
    return NextResponse.json(
      { error: "service_account_json required for first-time save" },
      { status: 400 },
    )
  }

  // Auto-capture the service-account email (a NON-secret identifier) so it can be
  // shown in the app-switcher / "reuse providers" picker without ever decrypting
  // the credential. Derived from the uploaded JSON; preserved from the existing
  // config on a package-only update.
  const existingCfg = (existing?.store_config as Record<string, unknown> | null) ?? {}
  // `client_email` is the canonical name (106) — Google's own field name in the SA JSON. The
  // `account_email` fallback reads a pre-106 app-scoped copy, which 106 strips once the app is
  // attached to an account; keeping the fallback costs nothing and covers an app that has not been.
  let accountEmail =
    (existingCfg.client_email as string) ?? (existingCfg.account_email as string) ?? undefined
  if (saJson) {
    try {
      accountEmail = (JSON.parse(saJson) as { client_email?: string }).client_email ?? accountEmail
    } catch {
      /* validated above */
    }
  }
  // Config splits by SCOPE, and the split is the whole point of the account tier: `client_email`
  // identifies the CREDENTIAL (one Play console, many apps) while `package_name` identifies THIS
  // app. Writing package_name onto the account would make every app attached to that console claim
  // the same package.
  const acctConfig: Record<string, unknown> = {}
  if (accountEmail) acctConfig.client_email = accountEmail
  const appConfig: Record<string, unknown> = { package_name: packageName }

  // Optional operator-supplied label; else the SA email names the connection, which is what an
  // operator recognises in a list of consoles.
  const accountLabel =
    (body.account_label ?? "").trim() ||
    ((existingCfg.account_label as string) ?? "") ||
    accountEmail ||
    ""

  // Writes to the ACCOUNT, then attaches this app. `tenant_providers_save_store_keys` wrote an
  // app-local blob — which migration 104's read path now shadows whenever an account resolves, so
  // a key saved the old way would appear to save and then not take effect.
  const { data: accountId, error } = await supabase.rpc("tenant_store_account_save", {
    p_tenant_id: tenant.id,
    p_provider: "google_play",
    p_credential: saJson || "", // "" → keep existing blob on update
    p_label: accountLabel,
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