// supabase/functions/identity-token/__tests__/identity-token.test.ts
// PLAN-paycraft-verified-identity D2/D3: verify provider ID tokens without Supabase users.
//
// Strategy (same as config/__tests__): set IDENTITY_TOKEN_SKIP_SERVE before importing index.ts, then
// stub globalThis.fetch so supabase-js REST/RPC, the Google/Apple JWKS and token endpoints are all
// answered in-process. Tokens are signed with a REAL RS256 keypair whose public JWK the stubbed JWKS
// URLs serve, so jose's signature / iss / aud / exp checks run for real.
//
// Run:
//   deno test --allow-env --allow-net supabase/functions/identity-token/__tests__/identity-token.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { exportJWK, generateKeyPair, SignJWT } from "https://deno.land/x/jose@v5.9.6/index.ts";

Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
Deno.env.set("IDENTITY_TOKEN_SKIP_SERVE", "1");
Deno.env.set("PAYCRAFT_GOOGLE_WEB_CLIENT_ID", "paycraft-web.apps.googleusercontent.com");
Deno.env.set("PAYCRAFT_GOOGLE_WEB_CLIENT_SECRET", "stub-google-secret");

const { handleIdentityTokenRequest: handler } = await import("../index.ts");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const API_KEY = "pk_test_abc";
const TENANT = {
  id: "11111111-1111-1111-1111-111111111111",
  app_identifier: "com.example.app",
  auth_google_web_client_id: "tenant-web.apps.googleusercontent.com",
  auth_apple_services_id: "com.example.app.signin",
};

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function token(claims: Record<string, unknown>, opts: { iss: string; aud: string; exp?: string | number }) {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss)
    .setAudience(opts.aud)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "10m")
    .sign(privateKey);
}
const googleToken = (claims: Record<string, unknown>, aud = TENANT.auth_google_web_client_id, exp?: number) =>
  token({ email: "Buyer@Example.com ", email_verified: true, ...claims }, { iss: "https://accounts.google.com", aud, exp });
const appleToken = (claims: Record<string, unknown>, aud = TENANT.app_identifier) =>
  token({ email: "buyer@privaterelay.appleid.com", ...claims }, { iss: "https://appleid.apple.com", aud });

// ── fetch stub: tiny in-memory PostgREST + provider endpoints ───────────────────────────────────
type Row = Record<string, unknown>;
const sessions = new Map<string, Row>();
let tokenEndpointIdToken = "";
let lastTokenRequest: URLSearchParams | null = null;

const ok = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function matches(row: Row, q: URLSearchParams) {
  for (const [k, v] of q) {
    if (["select", "or", "columns"].includes(k)) continue;
    const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
    if (op === "eq" && String(row[k]) !== val) return false;
    if (op === "lt" && !(String(row[k]) < val)) return false;
  }
  return true;
}

globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  // deno-lint-ignore no-explicit-any
  const url = new URL(typeof input === "string" ? input : (input as any).url ?? String(input));
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.href.startsWith("https://www.googleapis.com/oauth2/v3/certs") || url.href.startsWith("https://appleid.apple.com/auth/keys")) {
    return ok({ keys: [jwk] });
  }
  if (url.href === "https://oauth2.googleapis.com/token" || url.href === "https://appleid.apple.com/auth/token") {
    lastTokenRequest = new URLSearchParams(String(init?.body));
    return tokenEndpointIdToken ? ok({ id_token: tokenEndpointIdToken }) : ok({ error: "invalid_grant" }, 400);
  }
  if (url.pathname === "/rest/v1/rpc/tenant_apple_client_secret") return ok("stub-apple-client-secret");
  if (url.pathname === "/rest/v1/tenants") {
    const or = url.searchParams.get("or") ?? "";
    const id = url.searchParams.get("id");
    const hit = or.includes(`.eq.${API_KEY}`) || id === `eq.${TENANT.id}`;
    return ok(hit ? [TENANT] : []);
  }
  if (url.pathname === "/rest/v1/identity_sessions") {
    const q = url.searchParams;
    if (method === "POST") {
      const row = JSON.parse(String(init?.body)) as Row;
      if (sessions.has(String(row.id))) return ok({ code: "23505", message: "duplicate key" }, 409);
      sessions.set(String(row.id), { email: null, error: null, created_at: new Date().toISOString(), ...row });
      return ok(null, 201);
    }
    const hits = [...sessions.values()].filter((r) => matches(r, q));
    if (method === "GET") return ok(hits);
    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body)) as Row;
      for (const r of hits) Object.assign(r, patch);
      return ok(null, 204);
    }
    if (method === "DELETE") {
      for (const r of hits) sessions.delete(String(r.id));
      return ok(null, 204);
    }
  }
  return ok({ error: `unstubbed ${method} ${url.href}` }, 500);
}) as typeof fetch;

const base = "http://stub.local/functions/v1/identity-token";
const post = (path: string, body: unknown) =>
  handler(new Request(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const verify = (body: Record<string, unknown>) => post("/verify", { api_key: API_KEY, ...body });

const t = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

// ── /verify ─────────────────────────────────────────────────────────────────────────────────────
t("google valid → 200 lowercased email", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({ nonce: "n1" }), nonce: "n1" });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { email: "buyer@example.com", provider: "google" });
});

t("google aud = PayCraft's own web client → 200", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({}, "paycraft-web.apps.googleusercontent.com") });
  assertEquals(res.status, 200);
});

t("google wrong aud → 401 invalid_identity_token", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({}, "someone-else") });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "invalid_identity_token" });
});

t("google email_verified false → 401", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({ email_verified: false }) });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "invalid_identity_token" });
});

t("google nonce mismatch → 401", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({ nonce: "n1" }), nonce: "other" });
  assertEquals(res.status, 401);
});

t("expired token → 401", async () => {
  const exp = Math.floor(Date.now() / 1000) - 3600;
  const res = await verify({ provider: "google", id_token: await googleToken({}, undefined, exp) });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "invalid_identity_token" });
});

t("missing email → 401 token_has_no_email", async () => {
  const res = await verify({ provider: "google", id_token: await googleToken({ email: undefined }) });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "token_has_no_email" });
});

t("apple aud = app_identifier with sha256 nonce → 200", async () => {
  const id_token = await appleToken({ nonce: await sha256Hex("raw-nonce") });
  const res = await verify({ provider: "apple", id_token, nonce: "raw-nonce" });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { email: "buyer@privaterelay.appleid.com", provider: "apple" });
});

t("apple raw (unhashed) nonce → 401", async () => {
  const res = await verify({ provider: "apple", id_token: await appleToken({ nonce: "raw-nonce" }), nonce: "raw-nonce" });
  assertEquals(res.status, 401);
});

t("apple aud = services id → 200", async () => {
  const res = await verify({ provider: "apple", id_token: await appleToken({}, TENANT.auth_apple_services_id) });
  assertEquals(res.status, 200);
});

t("apple token presented as google → 401 (issuer pinned)", async () => {
  const res = await verify({ provider: "google", id_token: await appleToken({ email_verified: true }, TENANT.auth_google_web_client_id) });
  assertEquals(res.status, 401);
});

t("unknown api key → 401", async () => {
  const res = await post("/verify", { api_key: "pk_test_nope", provider: "google", id_token: "x" });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unknown_or_inactive_api_key" });
});

// ── /start, /callback, /result ──────────────────────────────────────────────────────────────────
const SESSION = "s".repeat(40);
const start = (provider: string, session: string) =>
  handler(new Request(`${base}/start?api_key=${API_KEY}&provider=${provider}&session=${session}`));

t("/start rejects a bad session id", async () => {
  assertEquals((await start("google", "short")).status, 400);
  assertEquals((await start("google", "bad!chars-" + "a".repeat(40))).status, 400);
});

t("/start google → 302 to Google with PayCraft web client + callback", async () => {
  const res = await start("google", SESSION);
  assertEquals(res.status, 302);
  const loc = new URL(res.headers.get("location")!);
  assertEquals(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assertEquals(loc.searchParams.get("client_id"), "paycraft-web.apps.googleusercontent.com");
  assertEquals(loc.searchParams.get("redirect_uri"), `${base}/callback`);
  assertEquals(loc.searchParams.get("state"), SESSION);
  assert(res.headers.get("location")!.includes("scope=openid%20email"));
  assertEquals(sessions.get(SESSION)?.status, "pending");
  assertEquals((await start("google", SESSION)).status, 409); // reuse refused
});

t("/callback google + /result is one-time (verified then 404)", async () => {
  assertEquals(await (await post("/result", { api_key: API_KEY, session: SESSION })).json(), { status: "pending" });

  tokenEndpointIdToken = await googleToken({}, "paycraft-web.apps.googleusercontent.com");
  const cb = await handler(new Request(`${base}/callback?code=abc&state=${SESSION}`));
  assertEquals(cb.status, 200);
  const page = await cb.text();
  assert(page.includes("Signed in."));
  assert(!page.includes(tokenEndpointIdToken), "token must never be echoed");
  assertEquals(lastTokenRequest?.get("client_secret"), "stub-google-secret");

  const r1 = await post("/result", { api_key: API_KEY, session: SESSION });
  assertEquals(await r1.json(), { status: "verified", email: "buyer@example.com" });
  const r2 = await post("/result", { api_key: API_KEY, session: SESSION });
  assertEquals(r2.status, 404);
});

t("/callback apple form_post uses services id + stored secret", async () => {
  const session = "a".repeat(64);
  const st = await start("apple", session);
  assertEquals(st.status, 302);
  const loc = new URL(st.headers.get("location")!);
  assertEquals(loc.searchParams.get("client_id"), TENANT.auth_apple_services_id);
  assertEquals(loc.searchParams.get("response_mode"), "form_post");

  tokenEndpointIdToken = await appleToken({}, TENANT.auth_apple_services_id);
  const cb = await handler(new Request(`${base}/callback`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: "xyz", state: session }).toString(),
  }));
  assert((await cb.text()).includes("Signed in."));
  assertEquals(lastTokenRequest?.get("client_id"), TENANT.auth_apple_services_id);
  assertEquals(lastTokenRequest?.get("client_secret"), "stub-apple-client-secret");
  assertEquals(await (await post("/result", { api_key: API_KEY, session })).json(), {
    status: "verified",
    email: "buyer@privaterelay.appleid.com",
  });
});

t("/callback cancel → failed, then consumed", async () => {
  const session = "c".repeat(48);
  await start("google", session);
  const cb = await handler(new Request(`${base}/callback?error=access_denied&state=${session}`));
  assert((await cb.text()).includes("Sign-in failed."));
  assertEquals(await (await post("/result", { api_key: API_KEY, session })).json(), { status: "failed", error: "cancelled" });
  assertEquals((await post("/result", { api_key: API_KEY, session })).status, 404);
});

t("/callback with a token for the wrong audience → failed", async () => {
  const session = "d".repeat(48);
  await start("google", session);
  tokenEndpointIdToken = await googleToken({}, "someone-else");
  await handler(new Request(`${base}/callback?code=abc&state=${session}`));
  assertEquals(await (await post("/result", { api_key: API_KEY, session })).json(), {
    status: "failed",
    error: "invalid_identity_token",
  });
});
