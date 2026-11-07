// supabase/functions/__tests__/apple-jwt-tenant-canary/green/apple-jwt.green.test.ts
// GREEN — App Store Server API tokens are signed with the APP's OWN key.
//
// Same defect as Play (device finding 2026-10-31): register-appstore and apple-server-notifications
// called appStoreServerJwt() with no credentials, so they needed deployment-wide APPLE_ASSA_* env —
// none of which production sets. Each app stores its own .p8 + key_id/issuer_id/bundle_id. A single
// env bundle id could never serve more than one app anyway: the token's `bid` claim names one app.
import "./_setup.ts"; // SUPABASE_* env — MUST precede the apple-jwt import
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { decodeJwt, decodeProtectedHeader } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { tenantAppStoreServerJwt } from "../../../_shared/apple-jwt.ts";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
const p8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;

const stored: Record<string, { credential: string | null; config: Record<string, string> }> = {
  "tenant-cappy": { credential: p8, config: { key_id: "KEYCAPPY01", issuer_id: "issuer-uuid", bundle_id: "com.mobilebytesensei.cappy" } },
  "tenant-nocfg": { credential: p8, config: {} },
};
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/rest/v1/rpc/tenant_providers_decrypt_store_key")) {
    const { p_tenant_id, p_provider } = JSON.parse(String(init?.body));
    assertEquals(p_provider, "app_store");
    return Response.json([stored[p_tenant_id] ?? { credential: null, config: {} }]);
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

Deno.test("GREEN: a tenant's stored App Store key signs the token, naming THAT app", async () => {
  const jwt = await tenantAppStoreServerJwt("tenant-cappy");
  assertEquals(decodeProtectedHeader(jwt).kid, "KEYCAPPY01");
  const claims = decodeJwt(jwt);
  assertEquals(claims.iss, "issuer-uuid");
  assertEquals(claims.bid, "com.mobilebytesensei.cappy");
});

Deno.test("GREEN: a stored key missing its ids fails with a message naming the app", async () => {
  await assertRejects(() => tenantAppStoreServerJwt("tenant-nocfg"), Error, "tenant-nocfg");
});

Deno.test("GREEN: no tenant and no env fails clearly (self-hosted fallback unchanged)", async () => {
  await assertRejects(() => tenantAppStoreServerJwt(null), Error, "APPLE_ASSA_KEY_ID");
});
