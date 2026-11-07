// supabase/functions/__tests__/play-jwt-tenant-canary/green/play-jwt.green.test.ts
// GREEN — Play purchase verification signs with the APP's OWN service account.
//
// Device finding 2026-10-31: register-play-purchase and google-rtdn called playDeveloperJwt() with no
// credentials, so they needed a deployment-wide GOOGLE_PLAY_SA_JSON. Production (multi-tenant) has
// none — each app stores its own Play service account (tenant_providers_decrypt_store_key) — so
// EVERY Play purchase failed to register (HTTP 500) and entitlement_records stayed empty.
import "./_setup.ts"; // SUPABASE_* env — MUST precede the play-jwt import
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { decodeJwt } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { tenantPlayDeveloperJwt } from "../../../_shared/play-jwt.ts";

// A real RSA key, so importPKCS8 + RS256 signing run for real — only the network is stubbed.
const kp = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
const sa = (email: string) => JSON.stringify({ client_email: email, private_key: pem });

const tenantCreds: Record<string, string | null> = { "tenant-cappy": sa("cappy-sa@proj.iam.gserviceaccount.com"), "tenant-none": null };
const rpcCalls: string[] = [];
let lastIssuer = "";

globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/rest/v1/rpc/tenant_providers_decrypt_store_key")) {
    const { p_tenant_id, p_provider } = JSON.parse(String(init?.body));
    rpcCalls.push(`${p_tenant_id}:${p_provider}`);
    return Response.json([{ credential: tenantCreds[p_tenant_id] ?? null, config: {} }]);
  }
  if (url === "https://oauth2.googleapis.com/token") {
    const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
    lastIssuer = String(decodeJwt(assertion).iss);
    return Response.json({ access_token: `token-for-${lastIssuer}` });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

Deno.test("GREEN: a tenant with a stored Play credential signs with THAT account", async () => {
  Deno.env.delete("GOOGLE_PLAY_SA_JSON"); // production: no deployment-wide credential
  const token = await tenantPlayDeveloperJwt("tenant-cappy");
  assertEquals(lastIssuer, "cappy-sa@proj.iam.gserviceaccount.com");
  assertEquals(token, "token-for-cappy-sa@proj.iam.gserviceaccount.com");
  assertEquals(rpcCalls.at(-1), "tenant-cappy:google_play");
});

Deno.test("GREEN: self-hosted (no tenant) falls back to GOOGLE_PLAY_SA_JSON", async () => {
  Deno.env.set("GOOGLE_PLAY_SA_JSON", sa("selfhost-sa@proj.iam.gserviceaccount.com"));
  await tenantPlayDeveloperJwt(null);
  assertEquals(lastIssuer, "selfhost-sa@proj.iam.gserviceaccount.com");
  Deno.env.delete("GOOGLE_PLAY_SA_JSON");
});

Deno.test("GREEN: a tenant with no credential and no env fails with a message naming the fix", async () => {
  await assertRejects(() => tenantPlayDeveloperJwt("tenant-none"), Error, "tenant-none");
});
