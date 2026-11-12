// supabase/functions/_shared/appstore-offer.ts
//
// App Store promotional-offer signatures (paycraft-paywall-analytics, GOAL D3 — the win-back offer on iOS).
//
// StoreKit applies a promotional offer to a purchase only with a signature from the app's In-App Purchase key
// (the same .p8 the App Store Server API uses, stored per app — `tenant_providers_decrypt_store_key`). Apple's
// spec ("Generating a signature for promotional offers"): ES256 over
//   appBundleId ⁣ keyIdentifier ⁣ productIdentifier ⁣ offerIdentifier ⁣ appAccountToken ⁣ nonce ⁣ timestamp
// joined with U+2063 (INVISIBLE SEPARATOR), the app-account token and nonce as lower-case UUIDs (token empty
// when none), timestamp in milliseconds; the signature base64-encoded DER. The private key never leaves here.

const SEP = "⁣"

export type PromotionalOfferInput = {
  bundleId: string
  productId: string
  offerId: string
  /** The purchase's appAccountToken (a UUID) when the app sets one; null/empty otherwise. */
  appAccountToken: string | null
  nonce: string
  timestamp: number
}

export function promotionalOfferPayload(i: PromotionalOfferInput & { keyId: string }): string {
  return [
    i.bundleId, i.keyId, i.productId, i.offerId,
    (i.appAccountToken ?? "").toLowerCase(), i.nonce.toLowerCase(), String(i.timestamp),
  ].join(SEP)
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "")
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer
}

/** WebCrypto ECDSA returns r‖s (IEEE P1363); Apple wants ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    let v = b.slice(i)
    if (v[0] & 0x80) v = Uint8Array.of(0, ...v)
    return Uint8Array.of(0x02, v.length, ...v)
  }
  const half = raw.length / 2
  const r = int(raw.slice(0, half)), s = int(raw.slice(half))
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s)
}

/** DER → r‖s (32 + 32 bytes for P-256) — for verifying with WebCrypto. */
export function derToRaw(der: Uint8Array): Uint8Array {
  const read = (at: number) => {
    const len = der[at + 1]
    let v = der.slice(at + 2, at + 2 + len)
    while (v.length > 32 && v[0] === 0) v = v.slice(1)
    const out = new Uint8Array(32)
    out.set(v, 32 - v.length)
    return { v: out, next: at + 2 + len }
  }
  const r = read(2)
  const s = read(r.next)
  return Uint8Array.of(...r.v, ...s.v)
}

export async function signPromotionalOffer(key: { keyId: string; privateKeyPem: string }, i: PromotionalOfferInput) {
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToDer(key.privateKeyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  const payload = promotionalOfferPayload({ ...i, keyId: key.keyId })
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, new TextEncoder().encode(payload)))
  const der = rawToDer(raw)
  return {
    offerId: i.offerId,
    keyIdentifier: key.keyId,
    nonce: i.nonce.toLowerCase(),
    timestamp: i.timestamp,
    signature: btoa(String.fromCharCode(...der)),
  }
}
