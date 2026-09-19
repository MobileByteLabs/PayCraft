example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

# KEY_TIERING.md — publishable vs secret, and how each reaches its consumer

> Consumed by `/idea-paycraft` chain step 4. Authored by `/paycraft-dev fold`.

PayCraft has two credential tiers for the *client*, plus a third that exists only for **headless
server-side callers**. Confusing the first two is the highest-severity integration mistake available,
in both directions — and the second direction (over-protecting a public key) is the one that quietly
blocks working integrations.

## Tier 1 — publishable (`pk_`), belongs in client source

`PayCraft.initialize(apiKey = "pk_live_…")`.

- Prefix is enforced at the call site: `pk_test_` or `pk_live_`, else `IllegalArgumentException`
  (the sole exemption is `PayCraftBackend.Mock`).
- The prefix *is* the environment switch. `PayCraft.mode` derives `Test` / `Live` from it, and that
  decides whether a provider's `testPaymentLinksBySku` or `livePaymentLinksBySku` map is read. There
  is no separate environment flag to keep in sync.
- Convention: `pk_test_*` in debug builds, `pk_live_*` in release builds.
- `PayCraft.isConfigured` answers "is a usable publishable key present?". **Ask the SDK** rather than
  re-deriving it by reading your own build config for a `pk_` prefix — that is how a host app ends up
  disagreeing with the SDK's own provisioning rule.
- **A publishable key is public by design.** It identifies a tenant to a server that enforces RLS; it
  authorises nothing on its own. The same is true of the Supabase anon key compiled into
  `PayCraftBackend.Cloud`.
- Scope is deliberately narrow: app-scoped and read-only against `/config` and the SDK's own
  key-authenticated endpoints (`checkout-initiate`, `coupon-validate`). It can never mutate a tenant.

**Governance, not secrecy.** A `pk_` key still originates from the vault so that rotation and
ownership are tracked — it is materialized through `/secrets-handoff` at project level, lands in the
project's materialized-secrets tree, and is then compiled into client source as a literal. Reading a
`pk_` value out of a build config at runtime buys nothing (it ships in the binary either way) and
costs a whole class of "works on my machine" failures.

**Do not** treat a `pk_` key as a leak. Flagging one as an exposed secret is a false positive that
stalls onboarding; the correct concern is whether it came from the vault and whether the right
test/live variant reached the right build type.

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
| **Reverse** | The `pk_` key the app initializes with is present, non-placeholder, correct-tier for the build type, and vault-originated | A blank/placeholder key (init throws, or the tenant resolves to nothing), or a `pk_test_` key in a release build (live buyers hit test payment links) |

Neither direction alone is sufficient. A scan that only looks for leaked secrets passes an app whose
paywall cannot load because the publishable key was never filled in.

## What "vault-originated" means operationally

1. The credential exists as a vault alias under the naming convention for its tier — org-shared
   values carry the workspace prefix, per-app values carry the project prefix.
2. It was materialized by the sanctioned secrets tooling, not pasted by hand.
3. For `pk_`: the resulting literal in client source matches the vault value for the build type.
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
