example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# KEY_TIERING.md — publishable vs secret, and how each reaches its consumer

> Consumed by `/idea-paycraft` chain step 4. Authored by `/paycraft-dev fold`.

PayCraft has exactly two credential tiers. Confusing them is the highest-severity integration
mistake available, in both directions — and the second direction (over-protecting a public key) is
the one that quietly blocks working integrations.

## Tier 1 — publishable (`pk_`), belongs in client source

`PayCraft.initialize(apiKey = "pk_live_…")`.

- Prefix is enforced at the call site: `pk_test_` or `pk_live_`, else `IllegalArgumentException`
  (the sole exemption is `PayCraftBackend.Mock`).
- The prefix *is* the environment switch. `PayCraft.mode` derives `Test` / `Live` from it, and that
  decides whether a provider's `testPaymentLinksBySku` or `livePaymentLinksBySku` map is read. There
  is no separate environment flag to keep in sync.
- Convention: `pk_test_*` in debug builds, `pk_live_*` in release builds.
- **A publishable key is public by design.** It identifies a tenant to a server that enforces RLS; it
  authorises nothing on its own. The same is true of the Supabase anon key compiled into
  `PayCraftBackend.Cloud`.

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
| Provider secret keys (`sk_live_…` / `sk_test_…`) | provider webhooks | Stripe/Razorpay/etc. |
| Provider webhook signing secrets | provider webhooks | Signature verification |
| Google Play service-account JSON | `google-rtdn`, `register-play-purchase` | Drives `play-jwt.ts` → Play Developer API |
| App Store Connect key (`.p8`) + key/issuer ids | `apple-server-notifications`, `register-appstore` | JWS verify + App Store Server API |
| Supabase service-role key | edge functions only | Bypasses RLS — catastrophic in a client |

These reach their consumer as **Supabase function secrets** (or CI secrets for deploys), sourced from
the vault. They never appear in `commonMain`, in an Android/iOS resource, in a committed properties
file, or in a repository at all.

## The rule in both directions

`/idea-paycraft` asserts key tiering **two-directionally**, because each direction has its own real
failure:

| Direction | Assertion | Failure it catches |
|---|---|---|
| **Forward** | No `sk_`-tier credential appears anywhere in client source or app resources | A secret key shipped in a binary — full provider account compromise |
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
- Use a service-role key anywhere a client could reach it.
