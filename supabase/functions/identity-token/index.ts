/**
 * identity-token — a VERIFIED buyer email without a Supabase user (PLAN-paycraft-verified-identity).
 *
 * PayCraft needs a verified email, never a session. Signing buyers into PayCraft's own Supabase made
 * every buyer of every app an `auth.users` row (MAU quota). Here the provider's ID token is verified
 * against the provider's PUBLIC JWKS and only the email comes back. Zero auth.users.
 *
 *   POST /verify   {api_key, provider, id_token, nonce?} → 200 {email, provider}          (D3)
 *   GET  /start    ?api_key&provider&session             → 302 to Google/Apple            (D2)
 *   GET|POST /callback  code+state (Apple: form_post)    → HTML "return to the app"       (D2)
 *   POST /result   {api_key, session}                    → {status, email?} (one-time)    (D2)
 *
 * Every token failure answers ONE shape (401 invalid_identity_token): distinguishing signature vs
 * expiry vs audience tells an attacker which part of a forged token to fix next. No token, secret
 * or provider error body is ever logged or echoed.
 *
 * env-optional: PAYCRAFT_GOOGLE_WEB_CLIENT_ID — only the rare Google WEB flow (iOS/desktop/web) needs
 *   it; /start answers 503 google_web_flow_not_configured until it is set, and /verify uses the
 *   tenant's own tenants.auth_google_web_client_id first.
 * env-optional: PAYCRAFT_GOOGLE_WEB_CLIENT_SECRET — same: /callback for Google fails closed without it.
 * env-optional: IDENTITY_TOKEN_SKIP_SERVE — test-only switch (skip Deno.serve so tests can import).
 */

import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

type Provider = "google" | "apple";

const GOOGLE = {
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  issuer: ["accounts.google.com", "https://accounts.google.com"],
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
};
const APPLE = {
  jwks: "https://appleid.apple.com/auth/keys",
  issuer: "https://appleid.apple.com",
  authorize: "https://appleid.apple.com/auth/authorize",
  token: "https://appleid.apple.com/auth/token",
};

const SESSION_RE = /^[A-Za-z0-9_-]{32,128}$/;
const API_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/; // also keeps the PostgREST `.or()` filter injection-proof
const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_PURGE_MS = 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const html = (ok: boolean) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>PayCraft sign-in</title></head><body style="font-family:system-ui;text-align:center;padding:48px 16px">` +
      `<p>${ok ? "Signed in. You can return to the app." : "Sign-in failed. Return to the app and try again."}</p>` +
      `</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const INVALID = () => json({ error: "invalid_identity_token" }, 401);

// One JWKS client per URL for the isolate's lifetime — jose caches + rotates keys itself.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(url: string) {
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, set);
  }
  return set;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a provider ID token. Returns the lowercased email, or `invalid` for ANY token failure
 * (`no_email` when the token is genuine but carries no email).
 */
export async function verifyIdToken(
  provider: Provider,
  idToken: string,
  audiences: string[],
  nonce?: string | null,
): Promise<{ email: string } | { error: "invalid" | "no_email" }> {
  if (!idToken || audiences.length === 0) return { error: "invalid" };
  try {
    const cfg = provider === "google" ? GOOGLE : APPLE;
    const { payload } = await jwtVerify(idToken, jwksFor(cfg.jwks), {
      issuer: cfg.issuer,
      audience: audiences,
    });
    if (provider === "google" && payload.email_verified !== true) return { error: "invalid" };
    if (nonce) {
      const expected = provider === "apple" ? await sha256Hex(nonce) : nonce;
      if (payload.nonce !== expected) return { error: "invalid" };
    }
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    return email ? { email } : { error: "no_email" };
  } catch {
    return { error: "invalid" };
  }
}

interface Tenant {
  id: string;
  app_identifier: string | null;
  auth_google_web_client_id: string | null;
  auth_apple_services_id: string | null;
}

async function tenantByApiKey(apiKey: string): Promise<Tenant | null | "error"> {
  if (!API_KEY_RE.test(apiKey)) return null;
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, app_identifier, auth_google_web_client_id, auth_apple_services_id")
    .or(`api_key_test.eq.${apiKey},api_key_live.eq.${apiKey}`)
    .eq("status", "active")
    .maybeSingle();
  if (error) return "error";
  return (data as Tenant | null) ?? null;
}

async function tenantById(id: string): Promise<Tenant | null> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id, app_identifier, auth_google_web_client_id, auth_apple_services_id")
    .eq("id", id)
    .maybeSingle();
  return (data as Tenant | null) ?? null;
}

const nonEmpty = (xs: Array<string | null | undefined>) =>
  xs.map((x) => (x ?? "").trim()).filter((x) => x.length > 0);

const googleWebClientId = () => (Deno.env.get("PAYCRAFT_GOOGLE_WEB_CLIENT_ID") ?? "").trim();
const googleWebClientSecret = () => (Deno.env.get("PAYCRAFT_GOOGLE_WEB_CLIENT_SECRET") ?? "").trim();
const selfUrl = () =>
  `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/identity-token`;

function asProvider(v: unknown): Provider | null {
  return v === "google" || v === "apple" ? v : null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ── POST /verify ───────────────────────────────────────────────────────────────────────────────
async function handleVerify(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await readBody(req);
  if (!body) return json({ error: "invalid_json" }, 400);

  const apiKey = String(body.api_key ?? "").trim();
  const provider = asProvider(body.provider);
  const idToken = String(body.id_token ?? "").trim();
  const nonce = body.nonce ? String(body.nonce) : null;
  if (!apiKey || !provider || !idToken) {
    return json({ error: "api_key, provider (google|apple) and id_token are required" }, 400);
  }

  const tenant = await tenantByApiKey(apiKey);
  if (tenant === "error") return json({ error: "tenant_lookup_failed" }, 500);
  if (!tenant) return json({ error: "unknown_or_inactive_api_key" }, 401);

  const audiences = provider === "google"
    ? nonEmpty([tenant.auth_google_web_client_id, googleWebClientId()])
    : nonEmpty([tenant.app_identifier, tenant.auth_apple_services_id]);

  const r = await verifyIdToken(provider, idToken, audiences, nonce);
  if ("error" in r) return r.error === "no_email" ? json({ error: "token_has_no_email" }, 401) : INVALID();
  return json({ email: r.email, provider });
}

// ── GET /start ─────────────────────────────────────────────────────────────────────────────────
async function handleStart(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const q = new URL(req.url).searchParams;
  const apiKey = (q.get("api_key") ?? "").trim();
  const provider = asProvider(q.get("provider"));
  const session = q.get("session") ?? "";
  if (!apiKey || !provider) return json({ error: "api_key and provider (google|apple) are required" }, 400);
  if (!SESSION_RE.test(session)) return json({ error: "invalid_session" }, 400);

  const tenant = await tenantByApiKey(apiKey);
  if (tenant === "error") return json({ error: "tenant_lookup_failed" }, 500);
  if (!tenant) return json({ error: "unknown_or_inactive_api_key" }, 401);

  const clientId = provider === "google" ? googleWebClientId() : (tenant.auth_apple_services_id ?? "").trim();
  if (!clientId) return json({ error: `${provider}_web_flow_not_configured` }, 503);

  const { error } = await supabaseAdmin
    .from("identity_sessions")
    .insert({ id: session, tenant_id: tenant.id, provider, status: "pending" });
  if (error) {
    return error.code === "23505" ? json({ error: "session_exists" }, 409) : json({ error: "session_create_failed" }, 500);
  }

  const redirect = `${selfUrl()}/callback`;
  const params: Record<string, string> = provider === "google"
    ? {
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email",
      state: session,
      prompt: "select_account",
    }
    : {
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      response_mode: "form_post",
      scope: "email",
      state: session,
    };
  const base = provider === "google" ? GOOGLE.authorize : APPLE.authorize;
  // URLSearchParams encodes spaces as '+'; providers expect %20 for scope.
  const qs = new URLSearchParams(params).toString().replace(/\+/g, "%20");
  return new Response(null, { status: 302, headers: { location: `${base}?${qs}`, "cache-control": "no-store" } });
}

// ── GET|POST /callback ─────────────────────────────────────────────────────────────────────────
async function handleCallback(req: Request): Promise<Response> {
  let params: URLSearchParams;
  if (req.method === "POST") {
    try {
      params = new URLSearchParams(await req.text());
    } catch {
      return html(false);
    }
  } else if (req.method === "GET") {
    params = new URL(req.url).searchParams;
  } else {
    return json({ error: "method_not_allowed" }, 405);
  }

  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!SESSION_RE.test(state)) return html(false);

  const { data: row } = await supabaseAdmin
    .from("identity_sessions")
    .select("id, tenant_id, provider, status, created_at")
    .eq("id", state)
    .maybeSingle();
  const s = row as { id: string; tenant_id: string; provider: Provider; status: string; created_at: string } | null;
  if (!s || s.status !== "pending" || Date.now() - Date.parse(s.created_at) > SESSION_TTL_MS) return html(false);

  const finish = async (patch: { status: "verified" | "failed"; email?: string; error?: string }) => {
    await supabaseAdmin.from("identity_sessions").update(patch).eq("id", s.id).eq("status", "pending");
    return html(patch.status === "verified");
  };

  if (params.get("error") || !code) return finish({ status: "failed", error: "cancelled" });

  let clientId = "";
  let clientSecret = "";
  if (s.provider === "google") {
    clientId = googleWebClientId();
    clientSecret = googleWebClientSecret();
  } else {
    const tenant = await tenantById(s.tenant_id);
    clientId = (tenant?.auth_apple_services_id ?? "").trim();
    const { data: secret } = await supabaseAdmin.rpc("tenant_apple_client_secret", { p_tenant_id: s.tenant_id });
    clientSecret = typeof secret === "string" ? secret : "";
  }
  if (!clientId || !clientSecret) return finish({ status: "failed", error: "not_configured" });

  let idToken = "";
  try {
    const res = await fetch(s.provider === "google" ? GOOGLE.token : APPLE.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${selfUrl()}/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tok = await res.json().catch(() => ({}));
    if (res.ok && typeof tok.id_token === "string") idToken = tok.id_token;
  } catch {
    // network failure — falls through to failed
  }
  if (!idToken) return finish({ status: "failed", error: "code_exchange_failed" });

  const r = await verifyIdToken(s.provider, idToken, [clientId]);
  if ("error" in r) {
    return finish({ status: "failed", error: r.error === "no_email" ? "token_has_no_email" : "invalid_identity_token" });
  }
  return finish({ status: "verified", email: r.email });
}

// ── POST /result ───────────────────────────────────────────────────────────────────────────────
async function handleResult(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await readBody(req);
  if (!body) return json({ error: "invalid_json" }, 400);
  const apiKey = String(body.api_key ?? "").trim();
  const session = String(body.session ?? "");
  if (!apiKey || !SESSION_RE.test(session)) return json({ error: "api_key and a valid session are required" }, 400);

  const tenant = await tenantByApiKey(apiKey);
  if (tenant === "error") return json({ error: "tenant_lookup_failed" }, 500);
  if (!tenant) return json({ error: "unknown_or_inactive_api_key" }, 401);

  // Opportunistic purge of abandoned handoffs.
  await supabaseAdmin
    .from("identity_sessions")
    .delete()
    .lt("created_at", new Date(Date.now() - SESSION_PURGE_MS).toISOString());

  const { data: row, error } = await supabaseAdmin
    .from("identity_sessions")
    .select("id, status, email, error")
    .eq("id", session)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (error) return json({ error: "session_lookup_failed" }, 500);
  const s = row as { id: string; status: string; email: string | null; error: string | null } | null;
  if (!s) return json({ error: "session_not_found" }, 404);
  if (s.status === "pending") return json({ status: "pending" });

  // One-time: a verified/failed result is consumed by reading it.
  await supabaseAdmin.from("identity_sessions").delete().eq("id", s.id).eq("tenant_id", tenant.id);
  return s.status === "verified"
    ? json({ status: "verified", email: s.email })
    : json({ status: "failed", error: s.error ?? "failed" });
}

export async function handleIdentityTokenRequest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/verify")) return await handleVerify(req);
  if (path.endsWith("/start")) return await handleStart(req);
  if (path.endsWith("/callback")) return await handleCallback(req);
  if (path.endsWith("/result")) return await handleResult(req);
  return json({ error: "not_found" }, 404);
}

if (!Deno.env.get("IDENTITY_TOKEN_SKIP_SERVE")) {
  Deno.serve(handleIdentityTokenRequest);
}
