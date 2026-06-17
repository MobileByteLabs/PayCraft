# PayCraft v2.0 — Production Launch Runbook

> Canonical sequence to take the production-ready codebase live at `https://paycraft.mobilebytesensei.com`.
>
> **Audience**: human operator with admin access to MobileByteLabs cloud accounts.
> **Estimated time**: 4-6 hours end-to-end, assuming all accounts already exist.
> **Idempotence**: every phase is re-runnable. Stop at any green checkpoint and resume later.
>
> Read every "Expected output" line before running the next command. If reality diverges, jump to **Rollback** (bottom) before improvising.

---

## Table of contents

1. [Phase 1 — Prerequisites](#phase-1--prerequisites)
2. [Phase 2 — Production Supabase project provisioning](#phase-2--production-supabase-project-provisioning)
3. [Phase 3 — Production Stripe Connect setup](#phase-3--production-stripe-connect-setup)
4. [Phase 4 — Production Razorpay setup (optional)](#phase-4--production-razorpay-setup-optional)
5. [Phase 5 — Cloudflare DNS apply](#phase-5--cloudflare-dns-apply)
6. [Phase 6 — Vercel project link + deploy](#phase-6--vercel-project-link--deploy)
7. [Phase 7 — Production database migration](#phase-7--production-database-migration)
8. [Phase 8 — KMP SDK publish to Maven Central](#phase-8--kmp-sdk-publish-to-maven-central)
9. [Post-launch validation](#post-launch-validation)
10. [Rollback procedure](#rollback-procedure)
11. [Known gotchas / risks](#known-gotchas--risks)
12. [Approvals required before pressing the button](#approvals-required-before-pressing-the-button)

---

## Phase 1 — Prerequisites

### 1.1 Accounts (verify each is provisioned, billing-active, and you have admin/owner role)

| Provider | Why | Sign-up / dashboard URL |
| --- | --- | --- |
| Supabase | Production database + Edge Functions + Auth | https://supabase.com/dashboard |
| Stripe | Primary payment provider (Connect platform) | https://dashboard.stripe.com |
| Razorpay (optional) | India-region payment provider | https://dashboard.razorpay.com |
| Cloudflare | DNS for `paycraft.mobilebytesensei.com` + WAF + rate-limit | https://dash.cloudflare.com |
| Vercel | Hosting for Next.js dashboard | https://vercel.com/dashboard |
| Postmark | Transactional email (welcome, receipt, reset) | https://account.postmarkapp.com |
| Sentry | Error tracking for dashboard + Edge Functions | https://sentry.io |
| Sonatype OSSRH | Maven Central publishing for KMP SDK | https://central.sonatype.org/publish/publish-portal-ossrh-staging-api/ |
| MobileByteLabs domain registrar | Owns `paycraft.mobilebytesensei.com` — confirm registrar lock OFF + nameservers point to Cloudflare | Wherever the domain was registered |

### 1.2 Local tooling (run each verifier; the version is a floor, not a ceiling)

```bash
supabase --version       # expect: 1.200.0 or higher
vercel --version         # expect: 39.x or higher
terraform --version      # expect: Terraform v1.6.0 or higher
gh --version             # expect: gh version 2.50.0 or higher
node --version           # expect: v20.x (LTS) or higher
npm --version            # expect: 10.x or higher
pnpm --version           # expect: 9.x or higher
java --version           # expect: openjdk 17.x or higher
sops --version           # expect: 3.8.x or higher
age --version            # expect: v1.1.x or higher
psql --version           # expect: psql (PostgreSQL) 15.x or higher
dig -v                   # expect: DiG 9.x
curl --version           # expect: curl 8.x
```

Install hints (macOS, Homebrew):

```bash
brew install supabase/tap/supabase vercel-cli terraform gh node pnpm openjdk@17 sops age postgresql@15
```

### 1.3 Framework session bound to PayCraft

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle
bash core/scripts/session-resolve.sh           # expect: mbs/PayCraft
```

If output is anything else, run `/context-start mbs/PayCraft` in a Claude session first.

### 1.4 Vault decrypted

```bash
bash core/scripts/secrets-list.sh --vault mbs | head -5
# expect: rows render; no "decryption failed" / "no SOPS_AGE_KEY" errors
```

If decryption fails, run `/secrets reauth` and re-run.

---

## Phase 2 — Production Supabase project provisioning

### 2.1 Login

```bash
supabase login
# Opens browser → authenticate with MobileByteLabs Supabase org owner account → CLI prints "You are now logged in."
```

### 2.2 List orgs to find ORG_ID

```bash
supabase orgs list
# Capture the row matching "MobileByteLabs" → ORG_ID field is the slug-id you need
```

### 2.3 Create the production project

```bash
# Defaults: name=paycraft-prod, region=us-east-1, plan=pro (manually selected in dashboard if needed)
supabase projects create paycraft-prod \
  --org-id <ORG_ID> \
  --region us-east-1 \
  --plan pro
# Expected output: "Created project paycraft-prod with ref <REF>"
# Save the REF — it's a 20-char lowercase string like ssuxufoxnjdyqcyfrfev
```

> **Region selection**: `us-east-1` is the default for the platform. Pick the region nearest your majority customer base. Once chosen, you cannot move the project — only export+reimport.

### 2.4 Persist the REF in PROJECT_CONFIG.yaml

Edit `/Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/PROJECT_CONFIG.yaml`:

```yaml
backend:
  provider: supabase
  environments:
    local:
      auto_generated: true
    production:
      supabase_project_ref: "<REF>"   # <-- fill the value from 2.3
```

Commit through a Claude session — never bypass `/git-session-commit`.

### 2.5 Link the local source tree to the production project

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft
supabase link --project-ref <REF>
# Expected output: "Finished supabase link."
```

### 2.6 Verify the link works

```bash
supabase secrets list
# Expected: a table (possibly empty) of environment variables for the Edge runtime — NOT an auth error
```

If you see `Project not linked`, repeat 2.5 with the correct REF.

### 2.7 Push the production DB URL into the vault (no chat)

```bash
# Get the URL from the Supabase dashboard → Settings → Database → Connection string → URI
# Example: postgresql://postgres.<REF>:<PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Pattern A — macOS Keychain mediated (preferred, RULE-SECRETS-MACOS-001):
bash core/scripts/secrets-keychain-load.sh --init paycraft-prod db-url:PAYCRAFT_PROD_DB_URL
# (you will be prompted with a hidden input — paste the URL there, never in chat)
security find-generic-password -s paycraft-prod -a db-url -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-supabase-prod-db-url --stdin

# Pattern B — direct stdin from a vault-decrypted source (no Keychain step)
bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-supabase-prod-db-url --stdin < /path/to/url.txt
```

Repeat for the anon and service-role keys (Settings → API):

```bash
bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-supabase-prod-anon-key --stdin
bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-supabase-prod-service-role-key --stdin
```

### 2.8 Add the new aliases to `SECRETS_ALIAS_REGISTRY.yaml`

In a Claude session:

```bash
/secrets alias-add mbs-paycraft-supabase-prod-db-url --vault mbs --scope project --consumer mbs/PayCraft --env PAYCRAFT_PROD_DB_URL
/secrets alias-add mbs-paycraft-supabase-prod-anon-key --vault mbs --scope project --consumer mbs/PayCraft --env NEXT_PUBLIC_SUPABASE_ANON_KEY
/secrets alias-add mbs-paycraft-supabase-prod-service-role-key --vault mbs --scope project --consumer mbs/PayCraft --env SUPABASE_SERVICE_ROLE_KEY
```

### 2.9 Checkpoint

```bash
supabase projects list | grep paycraft-prod
# Expected: one row, status=active
```

---

## Phase 3 — Production Stripe Connect setup

### 3.1 Activate Connect on the platform account

Open https://dashboard.stripe.com/connect/applications/overview and click **Get started**.

Fill out the Stripe Connect platform application:
- **Application name**: PayCraft
- **Business website**: https://paycraft.mobilebytesensei.com
- **Brand color**: read from `dashboard/app/(marketing)/page.tsx` brand-primary token
- **Support email**: support@paycraft.mobilebytesensei.com
- **OAuth redirect**: `https://paycraft.mobilebytesensei.com/api/connect/oauth/callback`
- **Webhook endpoint**: `https://paycraft.mobilebytesensei.com/api/webhooks/stripe`

Submit and wait for Stripe approval — typically 1-3 business days. Do not proceed past 3.4 until the Dashboard banner reads **Live mode available**.

### 3.2 Generate live API keys

Once approved: https://dashboard.stripe.com/apikeys → toggle **Viewing test data** OFF → **Reveal live key**.

Two values are needed:
- **Publishable key**: `pk_live_...` (safe to embed in client-side)
- **Secret key**: `sk_live_...` (NEVER ship to a client; server-side only)

### 3.3 Push secrets into the vault (macOS Keychain pattern preferred)

```bash
# Live publishable key
bash core/scripts/secrets-keychain-load.sh --init paycraft-stripe live-pk:STRIPE_LIVE_PK
security find-generic-password -s paycraft-stripe -a live-pk -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-stripe-live-pk --stdin

# Live secret key
bash core/scripts/secrets-keychain-load.sh --init paycraft-stripe live-sk:STRIPE_LIVE_SK
security find-generic-password -s paycraft-stripe -a live-sk -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-stripe-live-sk --stdin
```

If on Linux (no Keychain), use direct stdin pipe:

```bash
bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-stripe-live-sk --stdin < /tmp/sk_live.txt
shred -u /tmp/sk_live.txt
```

### 3.4 Configure the production webhook endpoint

In Stripe Dashboard: https://dashboard.stripe.com/webhooks → **Add endpoint**

- **Endpoint URL**: `https://paycraft.mobilebytesensei.com/api/webhooks/stripe`
- **Listen to**: Events on Connected accounts (toggle ON)
- **Events to send**: select these 12 — `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`
- Click **Add endpoint**

Stripe reveals the **Signing secret** (`whsec_...`). Push it immediately:

```bash
bash core/scripts/secrets-keychain-load.sh --init paycraft-stripe live-whsec:STRIPE_LIVE_WHSEC
security find-generic-password -s paycraft-stripe -a live-whsec -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-stripe-live-webhook-secret --stdin
```

### 3.5 Register the OAuth client_id

Stripe Dashboard → https://dashboard.stripe.com/settings/applications → **Connect** card → copy the **Live client ID** (`ca_...`):

```bash
echo "<ca_id>" | bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-stripe-live-client-id --stdin
```

(Client IDs are not considered secret, but vaulting them keeps the alias registry coherent.)

### 3.6 Add aliases

```bash
/secrets alias-add mbs-paycraft-stripe-live-pk --vault mbs --scope project --consumer mbs/PayCraft --env NEXT_PUBLIC_STRIPE_PK
/secrets alias-add mbs-paycraft-stripe-live-sk --vault mbs --scope project --consumer mbs/PayCraft --env STRIPE_SECRET_KEY
/secrets alias-add mbs-paycraft-stripe-live-webhook-secret --vault mbs --scope project --consumer mbs/PayCraft --env STRIPE_WEBHOOK_SECRET
/secrets alias-add mbs-paycraft-stripe-live-client-id --vault mbs --scope project --consumer mbs/PayCraft --env STRIPE_CONNECT_CLIENT_ID
```

### 3.7 Checkpoint

```bash
bash core/scripts/secrets-list.sh --vault mbs | grep stripe-live
# Expected: 4 rows (pk, sk, webhook-secret, client-id)
```

---

## Phase 4 — Production Razorpay setup (optional)

> **Skip this phase if you are not launching in India on day 1.** You can add Razorpay post-launch without redeploying.

### 4.1 Switch to live mode

Razorpay Dashboard → toggle **Test Mode** OFF (top-right). The first time you do this, KYC must be approved — confirm at https://dashboard.razorpay.com/app/account-status.

### 4.2 Generate live API keys

https://dashboard.razorpay.com/app/keys → **Generate Live Key**. Two values:
- **Key ID**: `rzp_live_...`
- **Key Secret**: shown ONCE — push immediately or you must regenerate.

```bash
bash core/scripts/secrets-keychain-load.sh --init paycraft-razorpay live-key:RAZORPAY_LIVE_KEY
security find-generic-password -s paycraft-razorpay -a live-key -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-razorpay-live-key --stdin

bash core/scripts/secrets-keychain-load.sh --init paycraft-razorpay live-secret:RAZORPAY_LIVE_SECRET
security find-generic-password -s paycraft-razorpay -a live-secret -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-razorpay-live-secret --stdin
```

### 4.3 Configure the webhook

https://dashboard.razorpay.com/app/webhooks → **Add New Webhook**
- **Webhook URL**: `https://paycraft.mobilebytesensei.com/api/webhooks/razorpay`
- **Secret**: generate locally (`openssl rand -hex 32`) and paste
- **Alert email**: ops@paycraft.mobilebytesensei.com
- **Events**: `subscription.activated`, `subscription.charged`, `subscription.completed`, `subscription.cancelled`, `subscription.paused`, `subscription.resumed`, `subscription.halted`, `subscription.pending`, `payment.captured`, `payment.failed`

Push the secret you just generated:

```bash
echo "<the-openssl-secret>" | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-paycraft-razorpay-live-webhook-secret --stdin
```

### 4.4 Add aliases

```bash
/secrets alias-add mbs-paycraft-razorpay-live-key --vault mbs --scope project --consumer mbs/PayCraft --env RAZORPAY_KEY_ID
/secrets alias-add mbs-paycraft-razorpay-live-secret --vault mbs --scope project --consumer mbs/PayCraft --env RAZORPAY_KEY_SECRET
/secrets alias-add mbs-paycraft-razorpay-live-webhook-secret --vault mbs --scope project --consumer mbs/PayCraft --env RAZORPAY_WEBHOOK_SECRET
```

---

## Phase 5 — Cloudflare DNS apply

### 5.1 Confirm domain ownership

```bash
whois paycraft.mobilebytesensei.com | grep -iE 'registrar|registrant'
# Expected: lines confirming MobileByteLabs (or your registrar of choice) as registrant
```

If ownership is unconfirmed, **STOP**. Transfer the domain in first; do not proceed until WHOIS verifies.

### 5.2 Generate a Cloudflare API token

Visit https://dash.cloudflare.com/profile/api-tokens → **Create Token** → use the **Edit zone DNS** template:
- **Permissions**: Zone → DNS → Edit; Zone → Zone → Edit (needed for the rate-limit ruleset)
- **Zone Resources**: Include → Specific zone → `paycraft.mobilebytesensei.com`
- Click **Create Token**. Token shown ONCE.

```bash
bash core/scripts/secrets-keychain-load.sh --init paycraft-cloudflare api-token:CLOUDFLARE_API_TOKEN
security find-generic-password -s paycraft-cloudflare -a api-token -w | \
  bash core/scripts/secrets-push.sh --vault mbs --id mbs-cloudflare-api-token --stdin

/secrets alias-add mbs-cloudflare-api-token --vault mbs --scope project --consumer mbs/PayCraft --env CLOUDFLARE_API_TOKEN
```

### 5.3 Initialize Terraform

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft/infra/dns
terraform init
# Expected output: "Terraform has been successfully initialized!"
```

### 5.4 Plan

```bash
terraform plan \
  -var="cloudflare_token=$(bash ../../../../../../core/scripts/secrets-get.sh mbs-cloudflare-api-token --to-file /tmp/cf-token.txt && cat /tmp/cf-token.txt && shred -u /tmp/cf-token.txt)" \
  -var="supabase_project_ref=$(bash ../../../../../../core/scripts/secrets-get.sh mbs-paycraft-supabase-prod-anon-key --to-file /tmp/ref.txt > /dev/null; grep -oE '[a-z0-9]{20}' /tmp/ref.txt | head -1 && shred -u /tmp/ref.txt)"
```

Or simpler, with values exported via vault helpers:

```bash
export TF_VAR_cloudflare_token=$(bash ../../../../../../core/scripts/secrets-get.sh mbs-cloudflare-api-token --allow-claude-stdout)
export TF_VAR_supabase_project_ref="<REF from Phase 2.3>"
terraform plan
```

**Expected plan summary**: `Plan: 6 to add, 0 to change, 0 to destroy.` (zone + A root + CNAME www + CNAME api + MX + TXT-SPF + rate-limit ruleset; count varies if the zone already exists in Cloudflare).

### 5.5 Apply

```bash
terraform apply
# Type 'yes' when prompted. NEVER use -auto-approve here — DNS mistakes are public.
# Expected: "Apply complete! Resources: 6 added, 0 changed, 0 destroyed."
```

### 5.6 Verify DNS propagation

```bash
dig paycraft.mobilebytesensei.com +short
# Expected: 76.76.21.21 (Vercel anycast) — may take 1-5 min to propagate

dig www.paycraft.mobilebytesensei.com +short
# Expected: paycraft.mobilebytesensei.com. then 76.76.21.21

dig api.paycraft.mobilebytesensei.com +short
# Expected: <REF>.supabase.co. then a 1.2.3.4 IP

dig MX paycraft.mobilebytesensei.com +short
# Expected: 10 smtp.postmarkapp.com.

dig TXT paycraft.mobilebytesensei.com +short
# Expected: "v=spf1 a mx include:spf.mtasv.net ~all"
```

If any record fails to resolve after 10 minutes, check Cloudflare Dashboard → DNS for the record and confirm nameservers (Settings → Nameservers) match what your registrar reports.

### 5.7 Add the zone to the registrar (one-time)

If this is the first time the zone exists in Cloudflare, the registrar must point nameservers to the values shown in **Cloudflare Dashboard → paycraft.mobilebytesensei.com → Overview → Cloudflare nameservers**. This is a registrar UI action — no command-line equivalent.

---

## Phase 6 — Vercel project link + deploy

### 6.1 Login

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft/dashboard
vercel login
# Browser opens; sign in as the MobileByteLabs Vercel owner
# Expected CLI line: "Success! GitHub authentication complete for ..."
```

> Vercel CLI docs: https://vercel.com/docs/cli

### 6.2 Link the project

```bash
vercel link --project paycraft-dashboard --yes
# Expected output: "Linked to mobilebytelabs/paycraft-dashboard (created .vercel)"
```

If the project does not exist yet:

```bash
vercel projects add paycraft-dashboard
vercel link --project paycraft-dashboard --yes
```

### 6.3 Materialize env vars from the vault

Generate `.env.production.local` from the vault aliases:

```bash
bash ../../../../../core/scripts/secrets-pull.sh --project mbs/PayCraft --target dashboard/.env.production.local
# Expected: file created with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STRIPE_PK, STRIPE_SECRET_KEY,
#           STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID, NEXT_PUBLIC_SENTRY_DSN, ...
```

Push them into Vercel:

```bash
vercel env import .env.production.local production
# Expected: prompts for each var; choose 'y' to overwrite
```

Alternatively (one-by-one, scriptable):

```bash
while IFS='=' read -r k v; do
  [[ "$k" =~ ^[A-Z_] ]] || continue
  echo "$v" | vercel env add "$k" production
done < .env.production.local
```

### 6.4 First deploy (manual, sanity check)

```bash
vercel --prod
# Expected: builds with pnpm --filter dashboard build; outputs a https://paycraft-dashboard-...vercel.app URL
```

### 6.5 Attach the custom domain

```bash
vercel domains add paycraft.mobilebytesensei.com paycraft-dashboard
vercel domains add www.paycraft.mobilebytesensei.com paycraft-dashboard
# Expected: "Domain paycraft.mobilebytesensei.com added to paycraft-dashboard"
```

Vercel auto-issues a Let's Encrypt certificate within ~60 seconds because the CNAME already resolves.

### 6.6 Verify

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" https://paycraft.mobilebytesensei.com
# Expected: 200

curl -fsS https://paycraft.mobilebytesensei.com/pricing | grep -c "Pro"
# Expected: at least 1
```

### 6.7 Wire GitHub Actions for future deploys

Confirm `.github/workflows/deploy-cloud.yml` GitHub secrets exist on the repo:

```bash
gh secret list --repo MobileByteLabs/PayCraft | grep -E 'VERCEL|SUPABASE_PROD_REF|SUPABASE_ACCESS_TOKEN|NEXT_PUBLIC'
# Expected rows: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, SUPABASE_PROD_REF,
#                SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL,
#                NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SENTRY_DSN
```

Missing ones go through `/secrets sync-to-ci` from a Claude session — never `gh secret set` by hand (RULE-SECRETS-VAULT-001).

After the first push to `main`, the workflow takes over and Vercel CLI deploys become a fallback path.

---

## Phase 7 — Production database migration

### 7.1 Pre-flight checks (each MUST pass)

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft
git status
# Expected: "nothing to commit, working tree clean"

git branch --show-current
# Expected: main (or a release/* branch that is merged into main)

gh pr checks
# Expected: every required check green; no FAIL or PENDING required gate
```

### 7.2 Run the framework completion gate

In a Claude session bound to `mbs/PayCraft`:

```
/project-complete
```

This single command chains:
- `/project-verify` (must PASS)
- `/project-health` (score >= 70)
- `/test` (all suites green)
- `/server env validate` (returns 200 from production)
- Final confirmation prompt

If any gate fails, **DO NOT promote**. Fix the failing gate first.

### 7.3 Promote the production database

```
/server promote --confirm
```

This applies all migrations `028..049+` from `supabase/migrations/` to the linked production Supabase project. Pre-promotion, the command prints a textual diff of every CREATE / ALTER / DROP and asks for explicit confirmation again.

Expected outcome: every migration row enters `supabase_migrations.schema_migrations` with the same version order as local.

### 7.4 Verify tables

```bash
PROD_DB_URL=$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-supabase-prod-db-url --allow-claude-stdout)
psql "$PROD_DB_URL" -c "\dt tenant_*"
# Expected rows: tenant_accounts, tenant_invites, tenant_members, tenant_settings,
#                tenant_subscriptions, tenant_api_keys, tenant_audit_log, ...

psql "$PROD_DB_URL" -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
# Expected: contiguous list ending at the highest local migration version
```

### 7.5 Verify RLS is on for every tenant table

```bash
psql "$PROD_DB_URL" -c "
  SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename LIKE 'tenant_%';
"
# Expected: rowsecurity = t (true) for every row
```

If any row shows `f`, halt and audit. RLS-off in production is a P0 incident.

### 7.6 Deploy Edge Functions

```bash
supabase functions deploy v2-config --project-ref <REF>
supabase functions deploy v2-billing --project-ref <REF>
supabase functions deploy stripe-connect-oauth --project-ref <REF>

for fn in stripe razorpay paddle paypal lemon-squeezy flutterwave paystack midtrans btcpay; do
  supabase functions deploy "${fn}-webhook" --project-ref <REF>
done
# Expected: each function prints "Deployed Function <name> on project <REF>"
```

(After the first push, this is handled automatically by `deploy-cloud.yml` job `deploy-functions`.)

### 7.7 Push function secrets

```bash
supabase secrets set \
  STRIPE_SECRET_KEY="$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-stripe-live-sk --allow-claude-stdout)" \
  STRIPE_WEBHOOK_SECRET="$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-stripe-live-webhook-secret --allow-claude-stdout)" \
  RAZORPAY_KEY_ID="$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-razorpay-live-key --allow-claude-stdout)" \
  RAZORPAY_KEY_SECRET="$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-razorpay-live-secret --allow-claude-stdout)" \
  RAZORPAY_WEBHOOK_SECRET="$(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-razorpay-live-webhook-secret --allow-claude-stdout)" \
  --project-ref <REF>
# Expected: "Finished supabase secrets set."
```

---

## Phase 8 — KMP SDK publish to Maven Central

### 8.1 Pre-flight

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft
grep '^paycraft.version' gradle.properties
# Expected: paycraft.version=2.0.0

git tag -l "v2.0.0"
# Expected: empty (we have not tagged yet)
```

### 8.2 Local sanity build

```bash
./gradlew :cmp-paycraft:assemble :cmp-paycraft:publishToMavenLocal
# Expected: BUILD SUCCESSFUL
ls ~/.m2/repository/io/github/mobilebytelabs/cmp-paycraft/2.0.0/
# Expected: cmp-paycraft-2.0.0.pom, .jar (all targets), .module
```

### 8.3 Confirm Maven Central credentials are wired in CI

```bash
gh secret list --repo MobileByteLabs/PayCraft | \
  grep -E 'OSSRH_USERNAME|OSSRH_PASSWORD|SIGNING_KEY|SIGNING_PASSWORD'
# Expected: all 4 rows present
```

Missing? Push from vault then sync:

```bash
/secrets sync-to-ci --project mbs/PayCraft --aliases mbs-paycraft-ossrh-username,mbs-paycraft-ossrh-password,mbs-paycraft-signing-key,mbs-paycraft-signing-password
```

### 8.4 Tag and push

```bash
git tag -a v2.0.0 -m "PayCraft v2.0.0 — production launch"
git push --tags origin v2.0.0
# Expected: "* [new tag]         v2.0.0 -> v2.0.0"
```

### 8.5 Watch the publish workflow

```bash
gh run watch --repo MobileByteLabs/PayCraft \
  $(gh run list --repo MobileByteLabs/PayCraft --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
# Expected: WORKFLOW JOB SUCCESS within ~15 min
```

The workflow:
1. Builds all targets (`androidRelease`, `iosArm64`, `iosX64`, `iosSimulatorArm64`, `jvm`, `js`, `wasmJs`, `linuxX64`, `macosArm64`, `macosX64`, `mingwX64`).
2. Signs every artifact with the in-vault GPG key.
3. Uploads to Sonatype OSSRH staging.
4. Closes + releases the staging repository (auto-promotes to Central).

### 8.6 Verify on Maven Central

After ~30 min (sync cadence):

```bash
curl -fsS https://repo1.maven.org/maven2/io/github/mobilebytelabs/cmp-paycraft/2.0.0/cmp-paycraft-2.0.0.pom | head -10
# Expected: a <project>...</project> XML pom file, NOT a 404 HTML page
```

Visible in the UI: https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-paycraft/2.0.0

### 8.7 Smoke a downstream consumer

In a fresh KMP project's `build.gradle.kts`:

```kotlin
implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0")
```

Then `./gradlew dependencies | grep cmp-paycraft`. The line must resolve from `mavenCentral()`, not `mavenLocal()`.

---

## Post-launch validation

### 9.1 Run the shipped smoke script

```bash
cd /Users/therajanmaurya/project-development/claude-product-cycle/workspaces/mbs/PayCraft/source/PayCraft
bash .github/workflows/cloud-smoke.yml  # NOT runnable directly — trigger via gh
gh workflow run cloud-smoke.yml --repo MobileByteLabs/PayCraft
gh run watch --repo MobileByteLabs/PayCraft \
  $(gh run list --repo MobileByteLabs/PayCraft --workflow=cloud-smoke.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Or run the equivalent locally:

```bash
curl -fsS -o /dev/null -w "Landing: %{http_code}\n" https://paycraft.mobilebytesensei.com/
curl -fsS https://paycraft.mobilebytesensei.com/pricing | grep -c "Pro"
curl -fsS -o /dev/null -w "Auth: %{http_code}\n" https://paycraft.mobilebytesensei.com/auth/signin
curl -fsS "https://api.paycraft.mobilebytesensei.com/functions/v1/v2-config?apiKey=pk_test_canary"
# Expected: 200 / >=1 / 200 / valid JSON (200) or 404 (canary missing — function up, key missing)
```

### 9.2 Sentry first event

Visit https://sentry.io → PayCraft project → Issues. Within 60 minutes of launch traffic, you should see *something* — even a synthetic 404 from a probe. If the project is silent after 24h, the DSN is wrong or the SDK is not initialized.

### 9.3 Postmark transactional email

Send a test welcome email:

```bash
curl -X POST "https://api.postmarkapp.com/email" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "X-Postmark-Server-Token: $(bash ../../../core/scripts/secrets-get.sh mbs-paycraft-postmark-server-token --allow-claude-stdout)" \
  -d '{
    "From": "noreply@paycraft.mobilebytesensei.com",
    "To": "you@example.com",
    "Subject": "PayCraft launch test",
    "TextBody": "If you got this, Postmark + SPF + MX records all work."
  }'
# Expected: {"MessageID": "...", "ErrorCode": 0, "Message": "OK"}
```

### 9.4 Run the framework smoke skill

In a Claude session:

```
/release-smoke-test --tier maximum
```

Tier-aware checks per the skill description: minimum→render only; medium→endpoints+RLS; maximum→per-capability deep.

### 9.5 First real Stripe test transaction (live mode)

Use a test card in live mode is impossible; use a real card with a `$0.50` price you can refund. From the dashboard:
1. Sign up as a new tenant.
2. Create a $0.50 product + price.
3. Generate a payment link.
4. Pay with your own card.
5. Confirm Stripe Dashboard → Payments shows the charge, the webhook fires, and `tenant_subscriptions` row gets `status='active'`.
6. Refund from Stripe Dashboard.

---

## Rollback procedure

### Migrations

Forward-only per RULE-SERVER-PROD-PUSH-001 — there is no automatic rollback. Each migration MUST ship an explicit companion `supabase/migrations/down/NNN_descriptive_name.sql`. To roll back migration N:

```bash
psql "$PROD_DB_URL" -f supabase/migrations/down/049_descriptive_name.sql
psql "$PROD_DB_URL" -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '049';"
```

If no `down/NNN_*.sql` exists, the migration is non-rollbackable. Plan a hotfix migration `050_revert_049.sql` instead.

### Vercel

```bash
vercel rollback <DEPLOYMENT_ID> --token=$(bash ../../../core/scripts/secrets-get.sh mbs-vercel-token --allow-claude-stdout)
# DEPLOYMENT_ID from: vercel ls paycraft-dashboard
# Last 3 deployments are retained (per /release Q3 retention policy)
```

### Edge Functions

```bash
git checkout <previous-commit-sha> -- supabase/functions/<fn>
supabase functions deploy <fn> --project-ref <REF>
git checkout HEAD -- supabase/functions/<fn>
```

### Maven Central

**Cannot be unpublished once released.** Mitigation: publish a patch version with the regression reverted.

```bash
# Bump gradle.properties: paycraft.version=2.0.1
git commit -am "fix: revert <breaking change> from 2.0.0"
git tag v2.0.1 && git push --tags
```

### DNS

```bash
cd infra/dns
terraform destroy -target=cloudflare_record.<name>
# Re-create with corrected config and `terraform apply`
```

---

## Known gotchas / risks

### Next.js 14 → 16 upgrade pending
Dashboard currently runs Next.js 14. Two open CVEs apply:
- **GHSA-f82v-jwr5-mffw** — middleware bypass under specific routing setups.
- **postcss XSS** (transitive via `next`).

Both are critical/moderate. Mitigation: ship migration before public scale (>100 active tenants). Tracked in `plan-layer/project-plans/mbs/PayCraft/active/paycraft-nextjs-16-upgrade/`.

### Stripe SDK API version pin
The Kotlin/JVM Stripe SDK does not currently export `Stripe.LatestApiVersion`. We pin to the literal `2026-05-27.dahlia` in `server/StripeProvider.kt`. When the SDK updates, audit that the literal still matches `Stripe.LatestApiVersion` to avoid silent decode failures on new event types.

### Supabase free-tier limits
The default Supabase plan is Free (500 MB DB, 2 GB egress/mo, 7-day backup retention). Public launch must upgrade to **Pro ($25/mo)** for:
- Daily backups + 14-day retention
- No project pausing on inactivity
- 8 GB DB + 250 GB egress

Pricing reference plan: `plan-layer/project-plans/mbs/PayCraft/active/pricing-260429/`.

### GDPR sign-off
`infra/security/gdpr-checklist.md` exists but is not yet ticked. Required before serving EU consumer traffic. Open items typically: DPA template, sub-processor list, data export endpoint, deletion endpoint, breach notification SLA.

### Domain ownership
`paycraft.mobilebytesensei.com` MUST be in the MobileByteLabs registrar account before Phase 5. Confirm via `whois paycraft.mobilebytesensei.com` (Phase 5.1) — if the registrant is anything other than the MobileByteLabs entity, halt and transfer the domain first.

### Stripe Connect approval lead time
Section 3.1 can block on Stripe's manual review for **1-3 business days**. Schedule the launch window so this lands a week early; do not assume same-day approval.

### Postmark sender verification
Postmark requires confirming the `noreply@paycraft.mobilebytesensei.com` sender via a DKIM record before any email goes out. Add the DKIM TXT record Postmark generates to `infra/dns/paycraft-cloud.tf` and re-apply (Phase 5.5) before Phase 9.3.

---

## Approvals required before pressing the button

Do NOT execute Phase 7 (`/server promote --confirm`) or Phase 8 (`git push --tags`) until all four green-lit:

| Owner | Approval | Artifact |
| --- | --- | --- |
| Stakeholders | Launch announcement copy + timing | Phase 14 of `paycraft-multiplatform-billing` epic (`plan-layer/project-plans/mbs/PayCraft/active/paycraft-multiplatform-billing/PLAN.md`) |
| Legal | Terms of Service | `infra/security/TERMS_OF_SERVICE.md` (signed off) |
| Legal | Privacy Policy | `infra/security/PRIVACY_POLICY.md` (signed off) |
| Legal | Data Processing Agreement template | `infra/security/DPA_TEMPLATE.md` (signed off, ready to send to EU customers) |
| Product | Pricing tiers | `dashboard/app/(marketing)/pricing/page.tsx` Free + Pro $29 + Enterprise (custom) confirmed |
| Security | GDPR checklist | `infra/security/gdpr-checklist.md` (all rows ticked) |
| Eng lead | Final go/no-go | Confirmed via Slack `#paycraft-launch` thread |

Once all six rows are checked, the operator has the mandate to proceed. Run phases in order, observe each "Expected output" line, and treat any divergence as a STOP signal.

---

## Quick reference — command checklist

```
[ ] Phase 1  prerequisites verified (10 tool versions OK, vault decrypts)
[ ] Phase 2  supabase projects create paycraft-prod + PROJECT_CONFIG updated + link OK
[ ] Phase 3  Stripe live keys + webhook secret in vault + Connect approved
[ ] Phase 4  Razorpay live keys + webhook secret in vault (or explicitly skipped)
[ ] Phase 5  terraform apply OK; dig paycraft.mobilebytesensei.com / www / api / MX / SPF all resolve
[ ] Phase 6  vercel link + env import + custom domain + curl 200
[ ] Phase 7  /project-complete green + /server promote --confirm + RLS on every tenant_* table
[ ] Phase 8  git push --tags v2.0.0 + publish.yml green + curl maven-central .pom 200
[ ] Post     cloud-smoke.yml green + Sentry first event + Postmark test email + live $0.50 charge
```

Operator signs and dates each row as completed. Archive the signed copy under `plan-layer/project-plans/mbs/PayCraft/archive/<YYYY-MM>/launch-v2.0.0/SIGNED_RUNBOOK.md`.
