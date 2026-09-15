/**
 * Account API key hashing — the ONLY module the plaintext key ever passes through.
 *
 * SHA-256, not bcrypt or argon2. A key-derivation function exists to make low-entropy secrets
 * (passwords) expensive to guess; the plaintext here is 32 bytes from `crypto.getRandomValues`,
 * so its entropy is already maximal and stretching buys nothing against an attacker who must
 * brute-force 2^256. What it does buy is ~250ms of latency on an endpoint that runs at the head
 * of every headless C1..A7 chain, which is a real cost for no security gain. This is the same
 * reasoning behind GitHub PAT and Stripe restricted-key storage.
 *
 * RULE-SECRETS-NO-VALUE-EGRESS-001: the plaintext must never be logged, returned, re-emitted, or
 * passed anywhere but `hashKey`. There is deliberately no `console.*` call in this file, and the
 * Phase 1 gate greps for that absence — a debug line added here in a hurry would silently move a
 * live credential into a log aggregator.
 */

/** SHA-256 of the full plaintext (`sk_acct_<b64url-32>`) → 64 lowercase hex characters. */
export async function hashKey(plaintext: string): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Compare two hashes without leaking, through timing, HOW MUCH of a candidate matched.
 *
 * A plain `===` returns on the first differing byte, so response time correlates with the length
 * of the matching prefix and an attacker can recover the hash one byte at a time. The XOR
 * accumulation below always walks the full length — there is no early `return` inside the loop,
 * which is exactly what the gate's `grep -c 'diff |='` pins.
 *
 * Length is compared first and non-constant-time on purpose: the hash length is a public constant
 * (64), so it carries no secret to leak.
 */
export function verifyKeyConstantTime(hashA: string, hashB: string): boolean {
  if (hashA.length !== hashB.length) return false
  let diff = 0
  for (let i = 0; i < hashA.length; i++) {
    diff |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Mint a new account key: `sk_acct_` + 32 random bytes, base64url, unpadded.
 *
 * Returned to the caller exactly once. The caller's only sanctioned next move is to hand the
 * plaintext straight to the operator and persist `hashKey(plaintext)` — never the plaintext.
 */
export function generateAccountKey(): string {
  const raw = new Uint8Array(32)
  crypto.getRandomValues(raw)
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `sk_acct_${b64}`
}

/**
 * The non-secret prefix stored alongside the hash so a key is identifiable in a list view.
 *
 * Exactly 12 characters — `sk_acct_` plus 4 — to satisfy migration 118's `key_prefix_shape` CHECK.
 * Four base64url characters of a 32-byte key leave 2^232 unguessed, so this is not sensitive.
 */
export function keyPrefix(plaintext: string): string {
  return plaintext.slice(0, 12)
}
