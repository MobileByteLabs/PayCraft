// supabase/functions/_shared/apple-jwt.ts
//
// Real Apple App Store Server API bearer JWT (ES256), per
// https://developer.apple.com/documentation/appstoreserverapi/generating_tokens_for_api_requests
//
// This is production code — it signs a real ES256 JWT with the App Store Connect .p8 key.
// Live credentials (key id / issuer / bundle id / .p8) are injected as env in E6; when absent the
// function throws a clear error rather than silently returning a fake token.

import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { supabaseAdmin } from "./supabase-admin.ts";

// env-optional: APPLE_ASSA_KEY_ID — self-hoster fallback; tenantAppStoreServerJwt uses each app's own key.
// env-optional: APPLE_ASSA_ISSUER_ID — same.
// env-optional: APPLE_ASSA_BUNDLE_ID — same (one env bundle id can only ever serve one app).
// env-optional: APPLE_ASSA_PRIVATE_KEY — same.
function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`apple-jwt: missing required env ${name} (wire live credentials in E6)`);
  return v;
}

export interface AppleApiCreds {
  keyId: string;
  issuerId: string;
  bundleId: string;
  /** The .p8 private key in PKCS#8 PEM form. */
  privateKeyPem: string;
}

/**
 * Build a signed bearer token for the App Store Server API (valid ≤ 60 min).
 *
 * `creds` lets a PER-TENANT caller drive the token with a tenant's own decrypted
 * .p8 key + ids (dashboard store-sync / multi-tenant edge paths). When omitted the
 * single-tenant env credentials are used, so the existing
 * apple-server-notifications caller is unaffected.
 */
export async function appStoreServerJwt(creds?: AppleApiCreds): Promise<string> {
  const keyId = creds?.keyId ?? requireEnv("APPLE_ASSA_KEY_ID");
  const issuerId = creds?.issuerId ?? requireEnv("APPLE_ASSA_ISSUER_ID");
  const bundleId = creds?.bundleId ?? requireEnv("APPLE_ASSA_BUNDLE_ID");
  // The .p8 private key, in PKCS#8 PEM form, injected via env at deploy time (never committed).
  const privateKeyPem = creds?.privateKeyPem ?? requireEnv("APPLE_ASSA_PRIVATE_KEY");

  const key = await importPKCS8(privateKeyPem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 20) // 20 min — comfortably inside Apple's 60-min cap
    .setAudience("appstoreconnect-v1")
    .sign(key);
}

/**
 * App Store Server API token for the APP that owns a transaction — what the purchase-verification
 * paths (register-appstore, apple-server-notifications) must use.
 *
 * Each app stores its OWN .p8 key plus key_id / issuer_id / bundle_id (dashboard → tenant_providers,
 * decrypted by `tenant_providers_decrypt_store_key`). The APPLE_ASSA_* env is only the single-tenant
 * self-hosted fallback — and could never serve two apps, because the token's `bid` names one.
 * Calling [appStoreServerJwt] with no credentials made those paths depend on env production does not
 * set, so every iOS purchase failed to register. Found 2026-10-31 alongside the identical Play bug.
 *
 * @param tenantId the app, from resolveInboundTenant; null on a self-hosted deployment.
 */
export async function tenantAppStoreServerJwt(tenantId: string | null): Promise<string> {
  if (tenantId) {
    const { data, error } = await supabaseAdmin
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "app_store" })
      .maybeSingle<{ credential: string | null; config: Record<string, string> | null }>();
    if (error) throw new Error(`apple-jwt: tenant ${tenantId} credential lookup failed: ${error.message}`);
    if (data?.credential) {
      const cfg = data.config ?? {};
      if (!cfg.key_id || !cfg.issuer_id || !cfg.bundle_id) {
        throw new Error(
          `apple-jwt: tenant ${tenantId} App Store key is missing key_id/issuer_id/bundle_id — complete it in the dashboard`,
        );
      }
      return appStoreServerJwt({
        keyId: cfg.key_id,
        issuerId: cfg.issuer_id,
        bundleId: cfg.bundle_id,
        privateKeyPem: data.credential,
      });
    }
  }
  return appStoreServerJwt();
}
