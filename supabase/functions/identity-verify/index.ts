/**
 * identity-verify — turn a consumer's auth token into a VERIFIED PayCraft device registration.
 *
 * ## Why this exists
 *
 * `register_device` is reachable from `anon` and takes a client-supplied EMAIL. Since
 * `entitlement_subject_resolve` matches on (kind, provider, value) regardless of verified-ness, an
 * unverified claim returns the subject a real sign-in created — so anyone holding the publishable
 * key (it ships in every app binary) could name a victim's address and inherit their premium and
 * their balance. Migration 159 closed the same class on the balance RPCs by refusing a
 * caller-supplied subject ID; this closes the registration door by requiring PROOF instead of a
 * string.
 *
 * ## Why verification lives here and not in plpgsql
 *
 * JWT signature checking in SQL would mean fetching remote JWKS from inside the database and
 * hand-rolling crypto in plpgsql. Keeping it in one TypeScript file makes the trust boundary
 * auditable: everything below is "what did the token prove", and the only thing handed to Postgres
 * is already-verified claims via `register_verified_device` (service_role).
 *
 * ## Asymmetric only, deliberately
 *
 * Verification uses the tenant's PUBLIC JWKS (`tenants.auth_issuer_url`). PayCraft therefore never
 * stores a consumer's signing secret — a symmetric (HS256) scheme would require exactly that, and
 * one leaked tenant secret would let an attacker mint identities for that app at will. A tenant
 * whose issuer cannot serve a JWKS simply does not get verified identity; its devices stay
 * unverified, which is a working state (they keep anonymous/device-only access).
 *
 * POST { api_key, access_token, device_token, platform, device_name? }
 * 200  { subject_id, verified: true }
 * 4xx  { error }
 */

import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * One JWKS client per issuer, cached for the isolate's lifetime.
 *
 * `createRemoteJWKSet` does its own key caching and rotation; building a new one per request would
 * refetch the key set on every call and turn a signature check into a network round-trip against
 * the consumer's auth server — a self-inflicted rate limit on their project, not ours.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(issuerUrl: string) {
  const base = issuerUrl.replace(/\/+$/, "");
  let set = jwksCache.get(base);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    jwksCache.set(base, set);
  }
  return set;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const apiKey = String(body.api_key ?? "").trim();
  const accessToken = String(body.access_token ?? "").trim();
  const deviceToken = String(body.device_token ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  const deviceName = body.device_name ? String(body.device_name) : null;

  if (!apiKey || !accessToken || !deviceToken || !platform) {
    return json({ error: "api_key, access_token, device_token and platform are required" }, 400);
  }

  // ── which app is this, and can its tokens be verified at all ──────────────────────────────────
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id, auth_issuer_url")
    .or(`api_key_test.eq.${apiKey},api_key_live.eq.${apiKey}`)
    .eq("status", "active")
    .maybeSingle();

  if (tenantError) return json({ error: `tenant_lookup_failed: ${tenantError.message}` }, 500);
  if (!tenant) return json({ error: "unknown_or_inactive_api_key" }, 401);

  const issuer = (tenant.auth_issuer_url as string | null)?.trim();
  if (!issuer) {
    // NOT an error the client can fix, and NOT something to work around by trusting the token.
    // The tenant has not enabled verified identity; say so plainly so the operator knows the knob.
    return json({
      error: "verified_identity_not_configured",
      detail: "set tenants.auth_issuer_url to the app's auth issuer (e.g. https://<ref>.supabase.co)",
    }, 409);
  }

  // ── what did the token actually prove ─────────────────────────────────────────────────────────
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(accessToken, jwksFor(issuer), {
      // Supabase signs access tokens with `iss = <base>/auth/v1`. Pinning it stops a token minted
      // by a DIFFERENT project (whose JWKS this tenant does not control) from being accepted.
      issuer: `${issuer.replace(/\/+$/, "")}/auth/v1`,
    });
    claims = payload as Record<string, unknown>;
  } catch (e) {
    // Signature, expiry and issuer failures collapse to one answer on purpose: distinguishing them
    // tells an attacker which part of a forged token to fix next.
    return json({ error: "invalid_identity_token", detail: (e as Error).message }, 401);
  }

  const authSub = String(claims.sub ?? "").trim();
  if (!authSub) return json({ error: "token_has_no_subject" }, 401);

  // `email_verified` is advisory here — the SIGNATURE is what makes this trustworthy, and the email
  // is only ever an alias on an already-verified auth_user subject.
  const email = typeof claims.email === "string" && claims.email.trim() ? claims.email.trim() : null;

  // ── record it ─────────────────────────────────────────────────────────────────────────────────
  const { data: subjectId, error: regError } = await supabaseAdmin.rpc("register_verified_device", {
    p_tenant_id: tenant.id,
    p_auth_sub: authSub,
    p_email: email,
    p_device_token: deviceToken,
    p_platform: platform,
    p_device_name: deviceName,
  });

  if (regError) return json({ error: `registration_failed: ${regError.message}` }, 500);

  return json({ subject_id: subjectId, verified: true });
});
