import crypto from "node:crypto"

/**
 * Node-side (dashboard) native-store token minting — dependency-free.
 *
 * The dashboard runs on Node, so unlike the Deno edge functions
 * (supabase/functions/_shared/{play,apple}-jwt.ts, which use jose from a
 * deno.land URL) we mint tokens with Node's built-in `crypto`. Both the
 * Google service-account RS256 assertion and the App Store Connect ES256
 * token are standard JWTs — no external library needed.
 *
 * These mirror the edge helpers 1:1 in intent (same grant, same audience,
 * same scope) but take PER-TENANT credentials as arguments — that is the whole
 * point of Phase 2: a tenant's OWN decrypted SA JSON / .p8 drives the token,
 * not a single platform-wide env credential.
 *
 * SECURITY: credentials are used only to sign locally / exchange for a token.
 * Nothing here logs or returns the private key material.
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

// ── Google Play — service-account access token (androidpublisher) ──────────

export interface PlayServiceAccountJson {
  client_email: string
  private_key: string
  token_uri?: string
}

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"

/**
 * Exchange a service-account RS256 assertion for a short-lived Play Developer
 * API access token, per
 * https://developers.google.com/identity/protocols/oauth2/service-account
 * (same flow as the edge play-jwt.ts, in Node).
 */
export async function playAccessToken(sa: PlayServiceAccountJson): Promise<string> {
  if (!sa.client_email || !sa.private_key) {
    throw new Error("store-jwt: service account JSON missing client_email/private_key")
  }
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token"
  const now = Math.floor(Date.now() / 1000)

  const header = { alg: "RS256", typ: "JWT" }
  const claim = {
    iss: sa.client_email,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key)
  const assertion = `${signingInput}.${b64url(signature)}`

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
 * no `bid` claim) used to manage subscriptions/products — subtly different from
 * the App Store SERVER API token minted by the edge apple-jwt.ts (which adds a
 * `bid` claim for transaction lookups). Apple caps ASC API tokens at 20 min.
 *
 * Node's ECDSA sign() returns DER by default; JOSE needs raw R||S, so we pass
 * dsaEncoding: "ieee-p1363".
 */
export function appStoreConnectToken(creds: AppStoreConnectCreds): string {
  if (!creds.keyId || !creds.issuerId || !creds.privateKeyP8) {
    throw new Error("store-jwt: App Store Connect creds missing keyId/issuerId/privateKeyP8")
  }
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: "ES256", kid: creds.keyId, typ: "JWT" }
  const claim = {
    iss: creds.issuerId,
    iat: now,
    exp: now + 60 * 15, // 15 min — inside Apple's 20-min ASC-API cap
    aud: "appstoreconnect-v1",
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`
  const signature = crypto
    .createSign("SHA256")
    .update(signingInput)
    .sign({ key: creds.privateKeyP8, dsaEncoding: "ieee-p1363" })
  return `${signingInput}.${b64url(signature)}`
}
