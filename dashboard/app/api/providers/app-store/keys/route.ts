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
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<Body>
  const supabase = createClient()

  const p8 = (body.p8_key ?? "").trim()
  const keyId = (body.key_id ?? "").trim()
  const issuerId = (body.issuer_id ?? "").trim()
  const bundleId = (body.bundle_id ?? "").trim()

  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("store_credential_enc")
    .eq("tenant_id", tenant.id)
    .eq("provider", "app_store")
    .maybeSingle()
  const isUpdate = !!existing

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

  const { error } = await supabase.rpc("tenant_providers_save_store_keys", {
    p_tenant_id: tenant.id,
    p_provider: "app_store",
    p_credential: p8 || "", // "" → keep existing blob on update
    p_config: { key_id: keyId, issuer_id: issuerId, bundle_id: bundleId },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: isUpdate ? "update" : "create" })
}
