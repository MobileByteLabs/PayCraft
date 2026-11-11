// App Store promotional-offer signatures (paycraft-paywall-analytics AC-10). Apple accepts a promotional offer
// only with an ES256 signature over appBundleId ⁣ keyIdentifier ⁣ productIdentifier ⁣ offerIdentifier ⁣
// appAccountToken ⁣ nonce ⁣ timestamp (U+2063 separators; token and nonce lower-case UUIDs), base64 DER.
// This verifies our output against that exact payload with the matching public key — no App Store needed.
// Run: deno test --no-check supabase/functions/__tests__/appstore-offer-signature.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { derToRaw, promotionalOfferPayload, signPromotionalOffer } from "../_shared/appstore-offer.ts"

async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
  const b64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n")
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey }
}

const input = {
  bundleId: "com.sensei.social", productId: "com.sensei.social.pro.monthly", offerId: "winback50",
  appAccountToken: "6F9619FF-8B86-D011-B42D-00C04FC964FF", nonce: "8D8E0CC7-6C3A-4A4B-9F2C-6B3E2F1A0C11", timestamp: 1_799_999_999_000,
}

Deno.test("the payload is Apple's exact field order with U+2063 separators and lower-case UUIDs", () => {
  const p = promotionalOfferPayload({ ...input, keyId: "ABC123DEFG" })
  assertEquals(p.split("⁣"), [
    "com.sensei.social", "ABC123DEFG", "com.sensei.social.pro.monthly", "winback50",
    "6f9619ff-8b86-d011-b42d-00c04fc964ff", "8d8e0cc7-6c3a-4a4b-9f2c-6b3e2f1a0c11", "1799999999000",
  ])
  assertEquals(promotionalOfferPayload({ ...input, keyId: "K", appAccountToken: null }).split("⁣")[4], "")
})

Deno.test("the signature is a base64 DER ES256 signature that verifies over that payload", async () => {
  const { pem, publicKey } = await testKey()
  const signed = await signPromotionalOffer({ keyId: "ABC123DEFG", privateKeyPem: pem }, input)
  assertEquals(signed.keyIdentifier, "ABC123DEFG")
  assertEquals(signed.nonce, input.nonce.toLowerCase())
  assertEquals(signed.timestamp, input.timestamp)
  const der = Uint8Array.from(atob(signed.signature), (c) => c.charCodeAt(0))
  assertEquals(der[0], 0x30, "DER SEQUENCE")
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, derToRaw(der),
    new TextEncoder().encode(promotionalOfferPayload({ ...input, keyId: "ABC123DEFG" })))
  assert(ok, "signature verifies with the matching public key")
})

Deno.test("a different payload does not verify", async () => {
  const { pem, publicKey } = await testKey()
  const signed = await signPromotionalOffer({ keyId: "K", privateKeyPem: pem }, input)
  const der = Uint8Array.from(atob(signed.signature), (c) => c.charCodeAt(0))
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, derToRaw(der),
    new TextEncoder().encode(promotionalOfferPayload({ ...input, keyId: "K", offerId: "other" })))
  assert(!ok)
})
