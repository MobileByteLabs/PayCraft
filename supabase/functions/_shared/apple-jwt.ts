// supabase/functions/_shared/apple-jwt.ts
//
// Real Apple App Store Server API bearer JWT (ES256), per
// https://developer.apple.com/documentation/appstoreserverapi/generating_tokens_for_api_requests
//
// This is production code — it signs a real ES256 JWT with the App Store Connect .p8 key.
// Live credentials (key id / issuer / bundle id / .p8) are injected as env in E6; when absent the
// function throws a clear error rather than silently returning a fake token.

import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`apple-jwt: missing required env ${name} (wire live credentials in E6)`);
  return v;
}

/** Build a signed bearer token for the App Store Server API (valid ≤ 60 min). */
export async function appStoreServerJwt(): Promise<string> {
  const keyId = requireEnv("APPLE_ASSA_KEY_ID");
  const issuerId = requireEnv("APPLE_ASSA_ISSUER_ID");
  const bundleId = requireEnv("APPLE_ASSA_BUNDLE_ID");
  // The .p8 private key, in PKCS#8 PEM form, injected via env at deploy time (never committed).
  const privateKeyPem = requireEnv("APPLE_ASSA_PRIVATE_KEY");

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
