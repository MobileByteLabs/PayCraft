import { importPKCS8, SignJWT } from "jose"

/**
 * Edge-native (dashboard) native-store token minting.
 *
 * Uses `jose` (Web Crypto under the hood) so this runs on BOTH Node and the
 * Cloudflare edge runtime — same as the Deno edge functions
 * (supabase/functions/_shared/{play,apple}-jwt.ts). The Google service-account
 * RS256 assertion and the App Store Connect ES256 token are standard JWTs.
 *
 * These take PER-TENANT credentials as arguments — a tenant's OWN decrypted SA
 * JSON / .p8 drives the token, not a single platform-wide env credential.
 *
 * SECURITY: credentials are used only to sign locally / exchange for a token.
 * Nothing here logs or returns the private key material.
 */

// ── Google — service-account access token (any scope) ─────────────────────

export interface PlayServiceAccountJson {
  client_email: string
  private_key: string
  token_uri?: string
}

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"

/** A Google Play Developer API token from a tenant's own service account. */
export function playAccessToken(sa: PlayServiceAccountJson): Promise<string> {
  return googleAccessToken(sa, ANDROID_PUBLISHER_SCOPE)
}

/**
 * Exchange a service-account RS256 assertion for a short-lived access token for [scope], per
 * https://developers.google.com/identity/protocols/oauth2/service-account — Play (androidpublisher) with a
 * tenant's own account, GA4 (analytics.readonly) with PayCraft's Viewer account (lib/ga4.ts).
 */
export async function googleAccessToken(sa: PlayServiceAccountJson, scope: string): Promise<string> {
  if (!sa.client_email || !sa.private_key) {
    throw new Error("store-jwt: service account JSON missing client_email/private_key")
  }
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token"
  const now = Math.floor(Date.now() / 1000)

  const key = await importPKCS8(sa.private_key, "RS256")
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(`store-jwt: google token exchange failed (${res.status}): ${await res.text()}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("store-jwt: google token endpoint returned no access_token")
  return json.access_token
}

// ── Apple — App Store Connect API token (ES256) ────────────────────────────

export interface AppStoreConnectCreds {
  keyId: string
  issuerId: string
  /** The .p8 private key in PKCS#8 PEM form. */
  privateKeyP8: string
}

/**
 * Mint an App Store Connect API bearer token (ES256), per
 * https://developer.apple.com/documentation/appstoreconnectapi/generating_tokens_for_api_requests
 *
 * NOTE: this is the App Store CONNECT API token (aud "appstoreconnect-v1",
 * no `bid` claim). Apple caps ASC API tokens at 20 min. `jose` ECDSA emits raw
 * R||S (JOSE format) — exactly what Apple expects (no DER conversion needed).
 */
export async function appStoreConnectToken(creds: AppStoreConnectCreds): Promise<string> {
  if (!creds.keyId || !creds.issuerId || !creds.privateKeyP8) {
    throw new Error("store-jwt: App Store Connect creds missing keyId/issuerId/privateKeyP8")
  }
  const now = Math.floor(Date.now() / 1000)
  const key = await importPKCS8(creds.privateKeyP8, "ES256")
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: creds.keyId, typ: "JWT" })
    .setIssuer(creds.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 15) // 15 min — inside Apple's 20-min ASC-API cap
    .setAudience("appstoreconnect-v1")
    .sign(key)
}
