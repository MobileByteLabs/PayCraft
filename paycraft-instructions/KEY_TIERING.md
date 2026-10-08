example-provenance: 399a26bf0ae5b641a3bb69b79646e7930eb4cf59

# KEY_TIERING.md — publishable vs secret, and how each reaches its consumer

> Consumed by `/idea-paycraft` chain step 4. Authored by `/paycraft-corpus-fold`.

PayCraft has two credential tiers for the *client*, plus a third that exists only for **headless
server-side callers**. Confusing the first two is the highest-severity integration mistake available,
in both directions — and the second direction (over-protecting a public key) is the one that quietly
blocks working integrations.

## Tier 1 — publishable (`pk_`), belongs in client source

`PayCraft.initialize(apiKey = "pk_…")` — **ONE key per app.**

- The guard at the call site admits any **publishable** key: `apiKey.startsWith("pk_")`, else
  `IllegalArgumentException("apiKey must be a PayCraft publishable key (pk_…)…")`. The sole exemption
  is `PayCraftBackend.Mock`. An `sk_…` secret key is refused here — that is the half of the guard
  that must never relax.
- **The prefix is NOT the environment switch, and is not read at all.** `PayCraft.mode` resolves
  test/live in TWO steps:
  1. `InitOptions.modeOverride` — an explicit choice always wins
  2. the host build type — `PlatformInfo.isDebugBuild` → `Mode.Test`, else `Mode.Live`
  A `pk_test_`/`pk_live_` spelling is accepted and inert. Reading the prefix used to be step 2, and
  that step WAS the F35 defect: it short-circuited the build-type rule, so an app shipping its one
  `pk_live_` key resolved LIVE in debug builds. Removed 2026-10-08.
  Resolved mode decides whether a provider's `testPaymentLinksBySku` or `livePaymentLinksBySku` map
  is read, and is sent to the server as the `x-paycraft-mode` header (the server falls back to the
  key prefix when the header is absent, so an older SDK keeps working).
- Never `Mode.Unknown` once configured: an unrecognised key on a release build is **Live**, because a
  silent test-mode checkout charges nobody and nothing surfaces the loss.
- `PayCraft.isConfigured` answers "is a usable publishable key present?" — any `pk_` except a
  `pk_YOUR…` template placeholder. **Ask the SDK** rather than re-deriving it from your own build
  config; that is how a host ends up disagreeing with the SDK's own provisioning rule.
- A `pk_YOUR…` placeholder *initializes* and reports `isConfigured == false`, so the SDK serves a
  Free entitlement instead of throwing — the graceful path for a host that wires billing
  unconditionally.
- **A publishable key is public by design.** It identifies a tenant to a server that enforces RLS; it
  authorises nothing on its own. The same is true of the Supabase anon key compiled into
  `PayCraftBackend.Cloud`.
- Scope is deliberately narrow: app-scoped and read-only against `/config` and the SDK's own
  key-authenticated endpoints (`checkout-initiate`, `coupon-validate`). It can never mutate a tenant.

> **Do NOT reimplement the build-type branch in the host.** Carrying `PAYCRAFT_API_KEY_TEST` +
> `PAYCRAFT_API_KEY_LIVE` and a `USE_TEST_BILLING` opt-in is the anti-pattern this model replaced:
> every host that did it could disagree with the SDK, and cappy shipped `pk_live_` in its debug
> builds because the opt-in was never set. One key in; the SDK decides.

> **Key shape no longer affects behaviour.** Mode comes from the build type (or an explicit
> override), so a mode-less `pk_<hex>`, a legacy `pk_test_…` and a legacy `pk_live_…` all behave
> identically. New tenants get a mode-less key (`provision_app` / `rotate_api_key`, migration 148);
> tenants provisioned earlier keep their pair and are deliberately NOT backfilled.
>
> This is why F35 was fixed in the SDK rather than by rotating keys: measured on production
> 2026-10-08, ALL NINE tenants held `pk_live_`-prefixed keys, so every consumer app had the defect.
> Rotating nine publishable keys would have invalidated them for every already-released build;
> deleting one resolution step fixed all nine at once and broke nothing.

**Governance, not secrecy.** A `pk_` key still originates from the vault so that rotation and
ownership are tracked — it is materialized through `/secrets-handoff` at project level, lands in the
project's materialized-secrets tree, and is then compiled into client source as a literal. Reading a
`pk_` value out of a build config at runtime buys nothing (it ships in the binary either way) and
costs a whole class of "works on my machine" failures.

**Do not** treat a `pk_` key as a leak. Flagging one as an exposed secret is a false positive that
stalls onboarding; the only correct concern is whether it came from the vault. There is no longer a
"wrong variant" to get wrong for ANY key shape — mode comes from the build type, so a key cannot be
mismatched to a build. That is the point of the one-key model.

## Tier 2 — secret (`sk_`, service accounts, signing keys), never in client source

Everything a webhook or edge function needs to *verify* or *fetch truth*:

| Credential | Consumer | Notes |
|---|---|---|
| Provider secret keys (`sk_live_…` / `sk_test_…`) | provider webhooks, `checkout-initiate` | Stripe/Razorpay/etc. Decrypted server-side only, via `tenant_providers_decrypt_key` |
| Provider webhook signing secrets | provider webhooks | Signature verification |
| Google Play service-account JSON | `google-rtdn`, `register-play-purchase` | Drives `play-jwt.ts` → Play Developer API |
| App Store Connect key (`.p8`) + key/issuer ids | `apple-server-notifications`, `register-appstore` | JWS verify + App Store Server API |
| Supabase service-role key | edge functions only | Bypasses RLS — catastrophic in a client |

These reach their consumer as **Supabase function secrets** (or CI secrets for deploys), sourced from
the vault. They never appear in `commonMain`, in an Android/iOS resource, in a committed properties
file, or in a repository at all.

## Tier 3 — account API key (`sk_acct_`), server-side callers only

Created by migration 118 for **headless onboarding** — the case where something must act *as an
account* with no human session. It is exchanged at `POST /functions/v1/account-token` for a 15-minute
JWT carrying `sub = owner_user_id`, `role = authenticated`, after which every existing RPC, RLS
policy and `auth.uid()` guard applies unchanged.

Three properties are worth knowing before handling one:

- **It is `sk_`-tier.** Same handling as Tier 2: vault-originated, never in client source, never in a
  repository, never printed. It grants account-level mutation.
- **Only the SHA-256 hash is stored.** `account_api_keys.key_hash` carries a structural check that
  the value is 64 hex characters, so a bug that forgot to hash **cannot persist** — a `sk_acct_…`
  plaintext does not match. The audit probe is `select count(*) … where key_hash like 'sk_acct_%'`
  → 0.
- **SHA-256 rather than bcrypt/argon2 is deliberate, not an oversight.** A KDF exists to make
  *low-entropy* secrets expensive to guess; this plaintext is 32 bytes from `crypto.getRandomValues`,
  so stretching buys nothing against 2^256 and costs ~250 ms at the head of every headless chain.
  Comparison is constant-time (XOR-accumulate), because a plain `===` leaks how long a matching
  prefix was and lets an attacker recover the hash byte by byte.
- `_shared/account-key.ts` is the only module the plaintext passes through, and it contains **no
  `console.*` call at all** — the Phase 1 gate greps for that absence, because one debug line added
  in a hurry would move a live credential into a log aggregator
  (RULE-SECRETS-NO-VALUE-EGRESS-001).

## The rule in both directions

`/idea-paycraft` asserts key tiering **two-directionally**, because each direction has its own real
failure:

| Direction | Assertion | Failure it catches |
|---|---|---|
| **Forward** | No `sk_`-tier credential (`sk_live_`, `sk_test_`, `sk_acct_`, service-account JSON, `.p8`) appears anywhere in client source or app resources | A secret key shipped in a binary — full provider or account compromise |
| **Reverse** | The `pk_` key the app initializes with is present, non-placeholder, publishable, and vault-originated. There is no mode-correctness dimension: no key shape pins mode | A placeholder key (the app initializes but `isConfigured` is false, so every surface reports Free) |

Neither direction alone is sufficient. A scan that only looks for leaked secrets passes an app whose
paywall cannot load because the publishable key was never filled in.

## What "vault-originated" means operationally

1. The credential exists as a vault alias under the naming convention for its tier — org-shared
   values carry the workspace prefix, per-app values carry the project prefix.
2. It was materialized by the sanctioned secrets tooling, not pasted by hand.
3. For `pk_`: the resulting literal in client source matches the vault value. One key per app, so
   there is one value to match — not a per-build-type pair. A legacy two-key app matches the
   variant appropriate to each build type.
4. For `sk_`-tier: the value is present at its *consumer* (function/CI secret) and absent from every
   repository path.

A value that only exists in someone's shell history or a chat message is not vault-originated, and
the remedy is rotation plus a proper handoff — never "copy it into the repo so the build works".

## Never

- Print, echo, log, or paste a secret **value** — including into a terminal, a PR, or a transcript.
  Verification is done on presence and metadata, never on content.
- Ask a teammate for a credential over chat. Point them at the vault.
- Commit a `.env` file. A project managed by the framework's secrets tooling materializes into
  per-ecosystem local formats and has no `.env` at all.
- Use a service-role key anywhere a client could reach it — including "just for a moment" inside an
  edge function that could have used an account token instead.
