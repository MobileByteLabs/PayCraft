// supabase/functions/_shared/play-jwt.ts
//
// Real Google Play Developer API access token via the OAuth2 service-account (JWT-bearer) flow,
// per https://developers.google.com/identity/protocols/oauth2/service-account
//
// Production code: signs an RS256 assertion with the service-account private key and exchanges it
// at the Google token endpoint for a short-lived access token scoped to androidpublisher. The
// service-account JSON is injected as env in E6; when absent the function throws clearly.

import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { supabaseAdmin } from "./supabase-admin.ts";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadServiceAccount(): ServiceAccount {
  // env-optional: GOOGLE_PLAY_SA_JSON — self-hoster fallback only. playDeveloperJwt(creds ?? ...)
  // prefers the PER-TENANT decrypted service account, which is what multi-tenant installs use.
  const raw = Deno.env.get("GOOGLE_PLAY_SA_JSON");
  if (!raw) {
    throw new Error("play-jwt: missing GOOGLE_PLAY_SA_JSON env (wire live credentials in E6)");
  }
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("play-jwt: GOOGLE_PLAY_SA_JSON missing client_email/private_key");
  }
  return sa;
}

/**
 * Obtain a Play Developer API access token (bearer) via the JWT-bearer grant.
 *
 * `creds` lets a PER-TENANT caller drive the token with a tenant's own decrypted
 * service-account JSON (dashboard store-sync / multi-tenant edge paths). When
 * omitted the single-tenant env credential (GOOGLE_PLAY_SA_JSON) is used, so the
 * existing register-play-purchase / google-rtdn callers are unaffected.
 */
export async function playDeveloperJwt(creds?: ServiceAccount): Promise<string> {
  const sa = creds ?? loadServiceAccount();
  if (!sa.client_email || !sa.private_key) {
    throw new Error("play-jwt: service account missing client_email/private_key");
  }
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: ANDROID_PUBLISHER_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(key);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`play-jwt: token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("play-jwt: token endpoint returned no access_token");
  return json.access_token as string;
}

/**
 * Play Developer API token for the APP that owns a purchase — the one the purchase-verification
 * paths (register-play-purchase, google-rtdn) must use.
 *
 * Each app stores its OWN Play service account (dashboard → tenant_providers, decrypted by
 * `tenant_providers_decrypt_store_key`, which also resolves a pinned or inherited account). The
 * deployment-wide GOOGLE_PLAY_SA_JSON is only the single-tenant self-hosted fallback.
 *
 * Calling [playDeveloperJwt] with no credentials made those paths depend on the env alone, which a
 * multi-tenant deployment does not set — so every Play purchase failed to register (HTTP 500,
 * "missing GOOGLE_PLAY_SA_JSON") and nothing was ever recorded. Found on device 2026-10-31.
 *
 * @param tenantId the app, from resolveInboundTenant; null on a self-hosted deployment.
 */
export async function tenantPlayDeveloperJwt(tenantId: string | null): Promise<string> {
  if (tenantId) {
    const { data, error } = await supabaseAdmin
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "google_play" })
      .maybeSingle<{ credential: string | null }>();
    if (error) throw new Error(`play-jwt: tenant ${tenantId} credential lookup failed: ${error.message}`);
    if (data?.credential) return playDeveloperJwt(JSON.parse(data.credential) as ServiceAccount);
    // env-optional: GOOGLE_PLAY_SA_JSON — a tenant with no stored account may still be served by a
    // self-hoster's deployment-wide one; when neither exists, say which app needs connecting.
    if (!Deno.env.get("GOOGLE_PLAY_SA_JSON")) {
      throw new Error(
        `play-jwt: tenant ${tenantId} has no Google Play service account — connect Google Play for this app in the dashboard`,
      );
    }
  }
  return playDeveloperJwt();
}
