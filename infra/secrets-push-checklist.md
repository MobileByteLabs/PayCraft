# PayCraft v2.0 — Secrets Push Checklist

> **Run each command from the framework root** (`/Users/therajanmaurya/project-development/claude-product-cycle`).
> Every command uses **macOS Keychain Pattern 5** (RULE-SECRETS-MACOS-001) — secret values NEVER touch chat, shell history, or process listing.
>
> The pattern: (1) `secrets-keychain-load.sh --init` prompts for the value with hidden input and stores it in macOS Keychain → (2) `security find-generic-password -w | secrets-push.sh --stdin` pipes the Keychain value directly to the vault. Two steps, zero leaks.

## Step 0 — Prereqs

```bash
# Verify vault is ready
bash core/scripts/secrets-doctor.sh

# Verify alias registry has the 13 new aliases
grep -c "paycraft-stripe\|paycraft-razorpay\|paycraft-resend\|paycraft-sentry\|paycraft-encryption\|paycraft-vercel" \
  core/registries/SECRETS_ALIAS_REGISTRY.yaml
# expect: 13
```

## Step 1 — Stripe (4 secrets)

Get values from https://dashboard.stripe.com/apikeys (live mode) + https://dashboard.stripe.com/connect/settings.

```bash
# 1.1 — sk_live_*  (Stripe secret key)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-stripe-platform-secret-key:STRIPE_SECRET_KEY
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-stripe-platform-secret-key:STRIPE_SECRET_KEY -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-stripe-platform-secret-key --stdin --account-email mobilebytesensei@gmail.com

# 1.2 — pk_live_*  (Stripe publishable key — PUBLIC, but still vaulted for source-of-truth)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-stripe-platform-publishable-key:STRIPE_PUBLISHABLE_KEY
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-stripe-platform-publishable-key:STRIPE_PUBLISHABLE_KEY -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-stripe-platform-publishable-key --stdin --account-email mobilebytesensei@gmail.com

# 1.3 — whsec_*  (Stripe webhook signing secret — Dashboard → Webhooks → endpoint → Signing secret)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-stripe-platform-webhook-secret:STRIPE_WEBHOOK_SECRET
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-stripe-platform-webhook-secret:STRIPE_WEBHOOK_SECRET -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-stripe-platform-webhook-secret --stdin --account-email mobilebytesensei@gmail.com

# 1.4 — ca_*  (Stripe Connect client ID — Dashboard → Connect → Settings → Application name)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-stripe-connect-client-id:STRIPE_CONNECT_CLIENT_ID
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-stripe-connect-client-id:STRIPE_CONNECT_CLIENT_ID -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-stripe-connect-client-id --stdin --account-email mobilebytesensei@gmail.com
```

## Step 2 — Razorpay (3 secrets)

Get values from https://dashboard.razorpay.com/app/keys + https://dashboard.razorpay.com/app/webhooks.

```bash
# 2.1 — rzp_live_*  (Razorpay key ID)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-razorpay-key-id:RAZORPAY_KEY_ID
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-razorpay-key-id:RAZORPAY_KEY_ID -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-razorpay-key-id --stdin --account-email mobilebytesensei@gmail.com

# 2.2 — Razorpay key secret
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-razorpay-key-secret:RAZORPAY_KEY_SECRET
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-razorpay-key-secret:RAZORPAY_KEY_SECRET -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-razorpay-key-secret --stdin --account-email mobilebytesensei@gmail.com

# 2.3 — Razorpay webhook secret
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-razorpay-webhook-secret:RAZORPAY_WEBHOOK_SECRET
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-razorpay-webhook-secret:RAZORPAY_WEBHOOK_SECRET -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-razorpay-webhook-secret --stdin --account-email mobilebytesensei@gmail.com
```

> **NOTE**: Razorpay MCP keys (for personal dev automation via Claude) are NOT a PayCraft deploy
> dependency. They're tracked separately under registry group `mbs-razorpay-mcp` (user-scope) and
> consumed by `core/scripts/razorpay-mcp-auth-export.sh`. See framework PR for that helper.

## Step 3 — Resend (1 secret)

Sign up at https://resend.com → API Keys → Create API key (full access).

```bash
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-resend-api-key:RESEND_API_KEY
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-resend-api-key:RESEND_API_KEY -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-resend-api-key --stdin --account-email mobilebytesensei@gmail.com
```

## Step 4 — Sentry (2 secrets)

Sign up at https://sentry.io → Create project (Next.js) → Settings → Client Keys (DSN) + Auth Tokens.

```bash
# 4.1 — Sentry DSN (project → Client Keys)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-sentry-dsn:SENTRY_DSN
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-sentry-dsn:SENTRY_DSN -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-sentry-dsn --stdin --account-email mobilebytesensei@gmail.com

# 4.2 — Sentry auth token (org settings → Auth Tokens, scope: project:releases)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-sentry-auth-token:SENTRY_AUTH_TOKEN
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-sentry-auth-token:SENTRY_AUTH_TOKEN -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-sentry-auth-token --stdin --account-email mobilebytesensei@gmail.com
```

## Step 5 — Encryption key (1 secret, GENERATED — not from a service)

```bash
# Generate 32-byte AES key, push directly without ever displaying
openssl rand -base64 32 | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-encryption-key --stdin --account-email mobilebytesensei@gmail.com
```

## Step 6 — Vercel (3 secrets)

Sign up at https://vercel.com → connect GitHub → import MobileByteLabs/PayCraft repo → set root directory to `dashboard/`. Then:

```bash
# 6.1 — Vercel token (Account Settings → Tokens → Create, scope: PayCraft project, no expiry)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-vercel-token:VERCEL_TOKEN
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-vercel-token:VERCEL_TOKEN -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-vercel-token --stdin --account-email mobilebytesensei@gmail.com

# 6.2 — Vercel org ID (Account Settings → ID — this is NOT secret but is vaulted for completeness)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-vercel-org-id:VERCEL_ORG_ID
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-vercel-org-id:VERCEL_ORG_ID -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-vercel-org-id --stdin --account-email mobilebytesensei@gmail.com

# 6.3 — Vercel project ID (Project Settings → General → ID)
bash core/scripts/secrets-keychain-load.sh --init paycraft.mobilebytesensei.com paycraft-vercel-project-id:VERCEL_PROJECT_ID
security find-generic-password -s paycraft.mobilebytesensei.com -a paycraft-vercel-project-id:VERCEL_PROJECT_ID -w | \
  bash core/scripts/secrets-push.sh --vault mbs --secret-id paycraft-vercel-project-id --stdin --account-email mobilebytesensei@gmail.com
```

## Step 7 — Verify all 13 secrets exist in vault

```bash
bash core/scripts/secrets-verify.sh --required-for mbs/PayCraft
# expect: PASS for all 16 (3 existing + 13 new)
```

## Step 8 — Materialize to runtimes

After all 13 are vaulted, run the materialize scripts to write them to dashboard `.env.local`, Vercel, and Supabase Edge Functions in one shot. See:

- `infra/sync-to-vercel.sh` — pulls each Vercel-bound alias → `vercel env add NAME production`
- `infra/sync-to-supabase.sh` — pulls webhook + encryption secrets → `supabase secrets set NAME -`
- `bash core/scripts/secrets-pull.sh --manifest workspaces/mbs/PayCraft/secrets-manifest.yaml` — local dev `.env.local`

## Recovery

If a value gets entered wrong:
```bash
bash core/scripts/secrets-rotate.sh --vault mbs --secret-id <id> --reason "wrong-value-entered"
# then re-push via Pattern 5
```
