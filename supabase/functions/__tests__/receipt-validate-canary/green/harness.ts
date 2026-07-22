// supabase/functions/__tests__/receipt-validate-canary/green/harness.ts
//
// Two real fixtures for the green receipt canary:
//   1. An in-memory PostgREST stub (as in the idempotency canary) so assertPlayTokenNotReused
//      runs its REAL supabase query against a seeded google_play row.
//   2. A REAL StoreKit2-shaped JWS: we mint an EC P-256 keypair + self-signed X.509 leaf with
//      @peculiar/x509, sign a payload with jose (ES256, x5c header), and register the leaf's DER
//      SHA-256 as an allowed root via APPLE_ROOT_CA_EXTRA_FINGERPRINTS. verifyStoreKit2Jws then
//      performs its genuine chain-pin + signature verification — no crypto is stubbed.

import { CompactSign } from "https://deno.land/x/jose@v5.9.6/index.ts";
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.3";

x509.cryptoProvider.set(crypto);

// ---- 1. in-memory entitlement_records stub -------------------------------------------------
interface Row {
  [k: string]: unknown;
  provider: string;
  stable_txn_id: string;
}
const table: Row[] = [];
const RESERVED = new Set(["select", "on_conflict", "order", "limit", "offset"]);

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, val] of params) {
    if (RESERVED.has(key)) continue;
    if (val.startsWith("eq.") && String(row[key]) !== val.slice(3)) return false;
  }
  return true;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes("/rest/v1/entitlement_records")) {
    if (method === "GET") {
      const hits = table.filter((r) => matches(r, new URL(url).searchParams));
      return new Response(JSON.stringify(hits), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return originalFetch(input as Request, init);
}) as typeof fetch;

export function seedToken(token: string, appUserId: string): Promise<void> {
  table.push({ provider: "google_play", stable_txn_id: token, app_user_id: appUserId });
  return Promise.resolve();
}

// ---- 2. real StoreKit2-shaped JWS + registered test root ------------------------------------
const alg = { name: "ECDSA", hash: "SHA-256", namedCurve: "P-256" } as const;
const keys = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign", "verify"],
);
const leafCert = await x509.X509CertificateGenerator.createSelfSigned({
  serialNumber: "01",
  name: "CN=Test StoreKit Leaf",
  notBefore: new Date("2020-01-01"),
  notAfter: new Date("2040-01-01"),
  keys,
  signingAlgorithm: alg,
});
const leafDerB64 = leafCert.toString("base64");

// Register the self-signed leaf's DER SHA-256 as an allowed root (matches production's getThumbprint).
const thumb = new Uint8Array(await leafCert.getThumbprint("SHA-256"));
const thumbHex = Array.from(thumb).map((b) => b.toString(16).padStart(2, "0")).join("");
Deno.env.set("APPLE_ROOT_CA_EXTRA_FINGERPRINTS", thumbHex);

const payload = new TextEncoder().encode(
  JSON.stringify({ data: { originalTransactionId: "otx-green-1", environment: "Sandbox" } }),
);
const validJwsStr = await new CompactSign(payload)
  .setProtectedHeader({ alg: "ES256", x5c: [leafDerB64] })
  .sign(keys.privateKey);

// Tamper the signature segment (flip bytes) — chain + pin still pass, signature verify must fail.
function tamper(jws: string): string {
  const parts = jws.split(".");
  const sig = Uint8Array.from(
    atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  sig[0] ^= 0xff;
  sig[sig.length - 1] ^= 0xff;
  const b64 = btoa(String.fromCharCode(...sig))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${parts[0]}.${parts[1]}.${b64}`;
}
const tamperedJwsStr = tamper(validJwsStr);

export function validJws(): string {
  return validJwsStr;
}
export function tamperedJws(): string {
  return tamperedJwsStr;
}
