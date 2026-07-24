// supabase/functions/_shared/receipt-validate.ts
//
// E2 server-side receipt validation (GOAL AC4):
//   • verifyStoreKit2Jws     — real ES256 JWS verification of an Apple StoreKit2 / ASSN-V2
//                              signed payload: builds the x5c cert chain, pins the root to
//                              Apple Root CA - G3, and cryptographically verifies the signature.
//   • assertPlayTokenNotReused — refuses a Play purchaseToken already bound to a DIFFERENT
//                              app_user_id (replay / token theft).
//
// Crypto is real (jose + @peculiar/x509 + WebCrypto) — no stubbed signature checks. Live Apple/
// Play credentials are wired in E6; the verification code itself is production here.

import { compactVerify, importX509 } from "https://deno.land/x/jose@v5.9.6/index.ts";
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.3";
import { supabaseAdmin } from "./supabase-admin.ts";

x509.cryptoProvider.set(crypto);

// Apple Root CA - G3 DER SHA-256 thumbprint (lowercase hex, colon-free) — the production pin the
// StoreKit2 / App Store Server API cert chain must root at. Verified against Apple's published
// root: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
//   $ openssl x509 -inform DER -noout -fingerprint -sha256
//   63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
const APPLE_ROOT_CA_G3_FINGERPRINTS = new Set<string>([
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
]);

function b64urlToString(b64url: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Allowed root fingerprints = the production Apple pin plus any test/sandbox roots injected
 *  via APPLE_ROOT_CA_EXTRA_FINGERPRINTS (comma-separated lowercase hex). */
function allowedRootFingerprints(): Set<string> {
  const set = new Set(APPLE_ROOT_CA_G3_FINGERPRINTS);
  const extra = Deno.env.get("APPLE_ROOT_CA_EXTRA_FINGERPRINTS");
  if (extra) for (const fp of extra.split(",")) if (fp.trim()) set.add(fp.trim().toLowerCase());
  return set;
}

function derToPem(derB64: string): string {
  return `-----BEGIN CERTIFICATE-----\n${derB64.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`;
}

/**
 * Verify an Apple StoreKit2 / ASSN-V2 signed payload and return its decoded claims.
 *
 * Steps (mirrors Apple's app-store-server-library verification):
 *   1. Parse the protected header → x5c chain (leaf .. root, base64 DER).
 *   2. Verify each cert is issued by the next (leaf ⇐ intermediate ⇐ root).
 *   3. Pin the root cert's SHA-256 thumbprint to Apple Root CA - G3 (env-extendable for sandbox).
 *   4. Cryptographically verify the ES256 JWS signature against the leaf public key.
 */
export async function verifyStoreKit2Jws(signedTransaction: string): Promise<Record<string, any>> {
  const [headerB64] = signedTransaction.split(".");
  if (!headerB64) throw new Error("StoreKit2 JWS: malformed token");
  const header = JSON.parse(b64urlToString(headerB64));
  const x5c = header.x5c as string[] | undefined;
  if (!Array.isArray(x5c) || x5c.length < 1) {
    throw new Error("StoreKit2 JWS: untrusted x5c chain");
  }

  // Build cert objects and verify the chain links (each cert signed by its issuer).
  const certs = x5c.map((der) => new x509.X509Certificate(der));
  for (let i = 0; i < certs.length - 1; i++) {
    const parentKey = await certs[i + 1].publicKey.export();
    const linkOk = await certs[i].verify({ publicKey: parentKey, signatureOnly: true });
    if (!linkOk) throw new Error("StoreKit2 JWS: untrusted x5c chain");
  }

  // Pin the root (last cert in the chain) to Apple Root CA - G3.
  const root = certs[certs.length - 1];
  const rootFp = toHex(await root.getThumbprint("SHA-256"));
  if (!allowedRootFingerprints().has(rootFp)) {
    throw new Error("StoreKit2 JWS: untrusted x5c chain");
  }

  // Cryptographically verify the ES256 signature against the leaf public key.
  const leafKey = await importX509(derToPem(x5c[0]), "ES256");
  try {
    const { payload } = await compactVerify(signedTransaction, leafKey);
    return JSON.parse(new TextDecoder().decode(payload));
  } catch (_e) {
    throw new Error("StoreKit2 JWS: bad signature");
  }
}

/**
 * Reject a Play purchaseToken already bound to a DIFFERENT app_user_id. A subscription's
 * purchaseToken is stable across renewals, so a token surfacing under a new user is a replay /
 * theft attempt. Same-user re-presentation is allowed (idempotent restore).
 */
export async function assertPlayTokenNotReused(token: string, appUserId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("entitlement_records")
    .select("app_user_id")
    .eq("provider", "google_play")
    .eq("stable_txn_id", token)
    .maybeSingle();
  if (error) throw new Error(`play token lookup failed: ${error.message}`);
  if (data && data.app_user_id !== appUserId) {
    throw new Error("Play purchaseToken reuse rejected");
  }
}
