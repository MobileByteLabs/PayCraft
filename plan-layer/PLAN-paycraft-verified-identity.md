# PLAN — PayCraft verified identity WITHOUT Supabase users (supersedes native-identity D1/D2)

**Why.** PayCraft's in-SDK sign-in currently signs buyers into PayCraft's Supabase, so every buyer who
links becomes an `auth.users` row and counts toward PayCraft's MAU quota (50k on Free) — summed across
EVERY app that uses PayCraft. PayCraft needs only a *verified email*, never a session. So: verify the
provider's ID token ourselves and record the email. Zero `auth.users`, no MAU, no quota.

## Decisions

- **D1 Native token (no Supabase).** Android Google → Credential Manager `GetGoogleIdOption`
  (`serverClientId` = the tenant's Google Web client from `/config#auth`, `nonce`) → raw `id_token`.
  iOS Apple → `ASAuthorizationAppleIDProvider` (request.nonce = SHA-256(raw nonce)) → `identityToken`.
- **D2 Web fallback (Apple off-iOS; Google on iOS/desktop/web) = server-hosted OAuth code flow with a
  POLLING handoff** — no deep link, no manifest/Info.plist change in the consumer:
  `GET identity-token/start?api_key&provider&session` → 302 to the provider →
  `identity-token/callback` (Apple: `form_post`) exchanges the code, verifies the id_token, stores the
  verified email on the one-time `session` → HTML "Signed in — return to the app" →
  the app polls `POST identity-token/result {api_key, session}` on foreground (once, then deleted).
  Apple Return URL becomes `https://<ref>.supabase.co/functions/v1/identity-token/callback`.
- **D2b In-app browser, auto-return (2026-11-01, user-flagged "why not native / in-app browser").** Native
  where a native API exists (Android Google = Credential Manager, iOS Apple = ASAuthorization). Everywhere
  else — Apple has NO Android SDK; Google has no library-embeddable iOS SDK — the browser flow runs IN-APP,
  never the external browser: Android = Chrome Custom Tab (androidx.browser); iOS = ASWebAuthenticationSession.
  `/start` records the caller `platform`; `/callback`'s page then hands control straight back: Android →
  `intent://signin-complete#Intent;scheme=<app_identifier>.paycraft;package=<app_identifier>;end` (as built:
  Chrome adds CATEGORY_BROWSABLE to every web-launched intent, so it needs a BROWSABLE target — the SDK's own
  manifest merges `PayCraftAuthActivity` (singleTask, scheme `${applicationId}.paycraft`), which hosts the
  Custom Tab and clears it on return; still zero host-app manifest change), iOS →
  `<app_identifier>.paycraft://signin-complete` which ASWebAuthenticationSession intercepts by its
  callbackURLScheme (no Info.plist change). The app then reads `/result` immediately — no "switch back" step.
- **D3 Verification (edge fn `identity-token`, route `POST /verify {api_key, provider, id_token, nonce}`).**
  JWKS + `jose.jwtVerify`. Google: JWKS `https://www.googleapis.com/oauth2/v3/certs`, iss
  `accounts.google.com|https://accounts.google.com`, aud == `tenants.auth_google_web_client_id`,
  `email_verified` true. Apple: JWKS `https://appleid.apple.com/auth/keys`, iss `https://appleid.apple.com`,
  aud ∈ {`tenants.app_identifier`, `tenants.auth_apple_services_id`}. Nonce: Google `nonce == raw`;
  Apple `nonce == sha256hex(raw)`. Response `{email, provider}`; every failure → one 401 shape.
- **D4 Web-flow secrets.** Google web flow uses PayCraft's OWN Web client (`paycraft-google-oauth-client-id`
  / `-secret`, edge env `PAYCRAFT_GOOGLE_WEB_CLIENT_ID/SECRET`) — consent shows PayCraft; acceptable for
  the rare iOS/desktop/web Google path. Apple web flow MUST use the app's Services ID (Apple's sheet
  shows the primary app), so the app's client secret is stored per tenant ENCRYPTED
  (`tenants.auth_apple_client_secret_enc` via `encrypt_provider_key`; read service-role only).
- **D5 SDK.** Delete `NativeSignIn` + the kmp-supabase-auth dependency (also unblocks CI, which waited
  on unreleased 0.3.4). `PayCraftSignIn.launch(provider)` → native token (D1) or web flow (D2) → verify
  → `billing.onVerifiedSignIn(email)`. Host-supplied `loginWithOAuth(provider, idToken)` routes through
  the same `/verify`; the data client drops `install(Auth)`.
- **D6 State machine (drives the UI states the Stitch designs cover):** `Idle → Launching →
  (Native | Browser(waiting)) → Verifying → Linked(email) | Cancelled | Failed(reason)`.

## Out of scope (follow-up)
Server-issued nonces (replay window = token lifetime, ≤1h); binding later RPCs to the verified identity.
