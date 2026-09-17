/**
 * Account API key hashing — dashboard (issuance) side.
 *
 * This DELIBERATELY duplicates `supabase/functions/_shared/account-key.ts`, which is the edge
 * (verification) side. The two must produce byte-identical digests or every issued key fails to
 * verify — a total outage of the headless path that would look like "the key is wrong".
 *
 * Sharing one module was the first choice and does not work here: the dashboard's tsconfig maps
 * `@/*` to the dashboard root and its `include` is dashboard-relative, so a file under
 * `supabase/functions/**` is outside the compilation unit. Hoisting the module into a shared package
 * would mean introducing a workspace package for ~20 lines.
 *
 * Duplication is therefore accepted and CONSTRAINED BY A TEST rather than by discipline: the canary
 * `tests/fixtures/paycraft-onboard-canary/green/hash-parity/` runs a known vector through both
 * implementations and fails if they disagree. If someone "improves" one side, the canary goes red
 * before any key is issued against it.
 *
 * RULE-SECRETS-NO-VALUE-EGRESS-001: no `console.*` in this file. The plaintext passes through
 * `hashKey` and nowhere else.
 */

/** SHA-256 of the full plaintext → 64 lowercase hex characters. Must match the edge implementation. */
export async function hashKey(plaintext: string): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** `sk_acct_` + 32 random bytes, base64url, unpadded. Returned to the operator exactly once. */
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
 * First 12 characters (`sk_acct_` + 4) — the non-secret identifier stored beside the hash.
 * Must satisfy migration 118's `key_prefix_shape` CHECK, which accepts the base64url alphabet
 * including `-` and `_`.
 */
export function keyPrefix(plaintext: string): string {
  return plaintext.slice(0, 12)
}
