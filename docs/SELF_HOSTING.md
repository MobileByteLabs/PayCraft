# PayCraft Self-Hosting (Enterprise)

This runbook walks you through standing up the full PayCraft platform — Postgres,
GoTrue auth, Kong gateway, Edge Functions, and the Next.js dashboard — on a single
host using `docker compose`. Time-to-first-checkout from a clean VM: **~10 minutes**.

> **License**: the server stack (`infra/`, `server/`, `supabase/`, `dashboard/`)
> ships under Business Source License v1.1. Production use requires an Enterprise
> license from MobileByteLabs — see [Enterprise license](#9-enterprise-license).

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Quick start](#2-quick-start)
3. [Environment variables](#3-environment-variables)
4. [Migration bootstrap](#4-migration-bootstrap)
5. [SDK wiring](#5-sdk-wiring)
6. [Smoke test](#6-smoke-test)
7. [Troubleshooting](#7-troubleshooting)
8. [Updating](#8-updating)
9. [Enterprise license](#9-enterprise-license)

---

## 1. Prerequisites

| Requirement | Why | How to check |
| --- | --- | --- |
| Docker Engine ≥ 24 | Runs the stack | `docker --version` |
| Docker Compose v2 | `docker compose` (no hyphen) syntax | `docker compose version` |
| 4 GB free RAM | Postgres + Kong + Edge runtime + Node build | `free -m` (Linux) / Activity Monitor (macOS) |
| 5 GB free disk | Container images + Postgres volume | `df -h` |
| Ports `54321`-`54324` free on the host | Kong (`54321`), Postgres (`54322`), reserved (`54323`, `54324`) | `lsof -iTCP -sTCP:LISTEN -n -P \| grep 5432` |
| Port `3000` free on the host | Dashboard | `lsof -iTCP:3000 -sTCP:LISTEN` |
| `openssl` | Generate JWT + encryption secrets | `openssl version` |
| `curl` | Smoke test (Section 6) | `curl --version` |
| `psql` (optional) | Migration bootstrap; falls back to `docker exec` if absent | `psql --version` |

The stack has been validated on macOS 14 (Apple Silicon + Intel), Ubuntu 22.04
LTS, and Debian 12. Windows users should run inside WSL2 with the Docker Desktop
backend.

---

## 2. Quick start

The minimum path from clean checkout to a green smoke test:

```bash
cd infra/selfhost

# 1. Copy the env template and edit it (DB password + Stripe Connect platform creds)
cp .env.example .env
$EDITOR .env

# 2. Generate JWT-derived keys (anon + service role) and append them to .env
./generate-keys.sh > .env.generated
cat .env.generated >> .env

# 3. Boot Postgres + GoTrue + Kong first (the bootstrap script needs the DB up)
docker compose up -d db auth kong

# 4. Wait ~30s for Postgres to finish initdb, then apply migrations
sleep 30
./migrations-bootstrap.sh

# 5. Boot the edge runtime + dashboard
docker compose up -d edge-runtime dashboard

# 6. Open the dashboard — the first user who signs up is auto-promoted to
#    `owner` of a fresh tenant.
open http://localhost:3000   # macOS
# xdg-open http://localhost:3000  # Linux
```

The whole sequence is idempotent — re-running it on top of an existing stack
upgrades it without data loss.

---

## 3. Environment variables

Every variable below MUST be set in `.env` before `docker compose up`. The
compose file refuses to start if any `:?required` variable is empty.

| Variable | Description | How to generate / source |
| --- | --- | --- |
| `PAYCRAFT_DB_PASSWORD` | Postgres superuser password. Stored in the `paycraft-db` volume — pick something strong on day 1, you cannot rotate it without a `db reset`. | `openssl rand -base64 24` |
| `PAYCRAFT_JWT_SECRET` | HMAC secret used by GoTrue and the Edge runtime to sign / verify every JWT. **Same value must appear everywhere.** | `openssl rand -base64 32` |
| `PAYCRAFT_ANON_KEY` | Public JWT signed with `PAYCRAFT_ANON_KEY = role:anon`. Safe to embed in the dashboard + SDK — RLS enforces tenancy. | `./generate-keys.sh` (signs the JWT secret above) |
| `PAYCRAFT_SERVICE_ROLE_KEY` | JWT signed with `role:service_role` — bypasses RLS. **Server-side only.** Never ship to a mobile app or the dashboard's `NEXT_PUBLIC_*` env. | `./generate-keys.sh` |
| `PAYCRAFT_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key used by `stripe-connect` to encrypt platform-account access tokens at rest. 32 raw bytes encoded as hex. | `openssl rand -hex 32` |
| `PAYCRAFT_OAUTH_STATE_SECRET` | HMAC secret for the Stripe Connect OAuth `state` round-trip parameter. Prevents CSRF on the connect callback. | `openssl rand -hex 32` |
| `PAYCRAFT_PLATFORM_STRIPE_SECRET_KEY` | YOUR Stripe platform secret key (`sk_live_…` or `sk_test_…`) — the account that bills your customers. Leave blank if you only use Razorpay or Custom. | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `PAYCRAFT_PLATFORM_STRIPE_CLIENT_ID` | Your Stripe Connect platform OAuth client id (`ca_…`). Required for tenants to "Connect with Stripe" from your dashboard. | [dashboard.stripe.com/settings/applications](https://dashboard.stripe.com/settings/applications) |
| `PAYCRAFT_API_URL` | Public-facing URL for the Kong gateway. Used in webhook callbacks + dashboard redirects. Defaults to `http://localhost:54321`. | Set to `https://billing.yourdomain.com` once you put a TLS-terminating proxy in front. |
| `PAYCRAFT_DASHBOARD_URL` | Public-facing URL for the Next.js dashboard. Used in GoTrue's `SITE_URL` and OAuth callbacks. Defaults to `http://localhost:3000`. | Set to `https://dashboard.yourdomain.com` for prod. |

### Where each variable shows up

- `db`, `auth`, `edge-runtime` all read `PAYCRAFT_JWT_SECRET`. Rotating it
  invalidates **every** outstanding session and SDK token — only do this with a
  scheduled maintenance window.
- `PAYCRAFT_ANON_KEY` is mirrored into `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_PAYCRAFT_SUPABASE_ANON_KEY` for the dashboard. It is also the
  value you pass to the SDK's `SelfHosted(supabaseAnonKey = …)` constructor.
- `PAYCRAFT_SERVICE_ROLE_KEY` is consumed only by the `edge-runtime` and the
  dashboard's server-side routes. It MUST NOT leak into `NEXT_PUBLIC_*`.

---

## 4. Migration bootstrap

`infra/selfhost/migrations-bootstrap.sh` is the canonical applier. It:

1. Connects to Postgres using `PAYCRAFT_DB_PASSWORD` (via local `psql` if
   present, else falls back to `docker exec -i paycraft_db psql -U postgres`).
2. `CREATE TABLE IF NOT EXISTS _paycraft_migrations(version TEXT PRIMARY KEY,
   applied_at TIMESTAMPTZ NOT NULL DEFAULT now())` — the ledger that decides
   what has already been applied.
3. Lists every file in `server/migrations/*.sql` in lexical order.
4. For each file, checks `_paycraft_migrations.version`; if absent, runs the
   file inside a single transaction (`-1 -v ON_ERROR_STOP=1`) and records the
   version on success.
5. Prints a summary: `✅ migrations: N applied, M skipped`.

### Adding a migration from upstream PayCraft

When MobileByteLabs publishes a new PayCraft release, you typically need to
apply 1-N new SQL files.

```bash
cd /path/to/your/PayCraft/checkout
git pull origin main                     # or whatever release tag

# Re-run the bootstrap — only the new versions are applied; the ledger
# guarantees the old ones are skipped, even if they are still in the dir.
cd infra/selfhost
./migrations-bootstrap.sh
```

Expected output on a clean upgrade:

```
  apply 042_add_coupons_v2
  apply 043_widen_subscription_status
✅ migrations: 2 applied, 39 skipped
```

### Inspecting applied state

```bash
docker exec paycraft_db psql -U postgres -d postgres \
  -c "SELECT version, applied_at FROM _paycraft_migrations ORDER BY version;"
```

### Recovery from a partially applied migration

Because every migration runs inside a single transaction, a failure leaves the
ledger row absent — the next bootstrap retries from that file. No manual
cleanup needed. If a migration fails for a non-transactional reason (e.g.
`CREATE INDEX CONCURRENTLY`), fix the SQL upstream and re-run; the script will
retry.

> **Never edit a migration that has already been applied in production.**
> Add a follow-up file (`NNN_fix_…sql`) instead. See
> [`CLAUDE.md`](../CLAUDE.md) "Database Migrations — single source of truth".

---

## 5. SDK wiring

Point the Kotlin SDK at your self-hosted Kong gateway and pass the **anon** key
(never the service role key):

```kotlin
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend

PayCraft.initialize(
    apiKey = "pk_test_local",   // generated in /settings/api-keys on your dashboard
    backend = PayCraftBackend.SelfHosted(
        supabaseUrl     = "http://localhost:54321",         // or https://billing.acme.com
        supabaseAnonKey = "<your PAYCRAFT_ANON_KEY value>",
    ),
)
```

The SDK resolves `${supabaseUrl}/functions/v1/config?apiKey=…` for its
SuiteConfig fetch. Override the path via the third `configPath` argument if
you've reverse-proxied the gateway under a sub-path.

### Production hardening checklist

- Terminate TLS in front of Kong (Caddy / nginx / Cloudflare) and switch
  `PAYCRAFT_API_URL` + `PAYCRAFT_DASHBOARD_URL` to `https://`.
- Pin the Kotlin SDK call to your production URLs — `pk_live_…` API keys.
- Configure each tenant's Stripe / Razorpay webhook endpoint to
  `${PAYCRAFT_API_URL}/functions/v1/{stripe-webhook|razorpay-webhook}`.
- Schedule daily off-site backups of the `paycraft-db` volume.

---

## 6. Smoke test

The fastest signal that the stack is alive:

```bash
curl -fsS "http://localhost:54321/functions/v1/config?apiKey=pk_test_local" | jq .
```

Expected: a JSON document with `tenant_id`, `products`, `providers`, and
`paywall` keys — the same SuiteConfig the SDK will receive.

```json
{
  "tenant_id": "tenant-…",
  "products": [ … ],
  "providers": [ … ],
  "paywall": { … },
  "cache_ttl_seconds": 3600
}
```

If you see this, the entire path (Kong → edge-runtime → Postgres → RLS-scoped
RPC) is working. Wire your client app next.

### Other quick probes

```bash
# Kong gateway is up
curl -fsS http://localhost:54321/ | head -c 200

# Postgres accepts connections
docker exec paycraft_db pg_isready -U postgres

# Dashboard is reachable
curl -fsSI http://localhost:3000 | head -n 1
```

---

## 7. Troubleshooting

### Port already in use

Symptom: `docker compose up -d` exits with
`Bind for 0.0.0.0:54321 failed: port is already allocated`.

```bash
# Identify the conflicting process
lsof -iTCP:54321 -sTCP:LISTEN -n -P
# Stop the conflicting service (often a stale Supabase CLI instance)
supabase stop
# Or rebind PayCraft's port in docker-compose.yaml (kong.ports[0])
```

The same diagnosis applies to `54322` (Postgres) and `3000` (dashboard).

### Postgres container exits during boot

Symptom: `paycraft_db` keeps restarting; `docker logs paycraft_db` shows
`FATAL: password authentication failed` or an empty data directory.

Most common causes:

1. You changed `PAYCRAFT_DB_PASSWORD` after the volume was created.
   Postgres bakes the password into the initdb-time bytes — rotating it
   requires recreating the volume:
   ```bash
   docker compose down
   docker volume rm selfhost_paycraft-db
   docker compose up -d db
   ```
   **This destroys all subscriptions data.** Take a backup first.
2. The volume was created by a prior `supabase start` run and is incompatible.
   Same fix as above.

### Edge function returns 404 for `/functions/v1/config`

Symptom: `curl …/functions/v1/config?apiKey=…` → `{"message":"Function not found"}`.

```bash
# The edge runtime mounts ../../supabase/functions read-only — confirm the
# config function is on disk:
ls ../../supabase/functions/config

# If absent, you're on an older release. Pull upstream and re-run migrations:
git pull && ./migrations-bootstrap.sh

# Otherwise the runtime probably failed to import — check the logs:
docker logs paycraft_edge_runtime --tail 100
```

### `migrations-bootstrap.sh` aborts with "could not connect"

Symptom: `psql: error: could not connect to server: Connection refused`.

The script ran before Postgres finished its first-boot initdb. Wait 30 seconds
and retry. If it persists:

```bash
docker exec paycraft_db pg_isready -U postgres   # → "accepting connections"
# If "no response", inspect:
docker logs paycraft_db --tail 50
```

### Dashboard build hangs at `npm install`

Symptom: `paycraft_dashboard` container sits at `npm install` for >5 min.

The container performs an `npm install` on every boot. On slow or rate-limited
networks this can stall. Override with a host-side `node_modules`:

```bash
cd ../../dashboard
npm install --no-audit --no-fund
# Then re-up; the mounted node_modules is reused.
docker compose up -d dashboard
```

### SDK throws "401 Unauthorized" from a self-hosted backend

Two common causes:

1. The `supabaseAnonKey` you passed to the SDK does not match
   `PAYCRAFT_ANON_KEY` in `.env`. Verify they are byte-identical (including
   trailing newline trimming).
2. The JWT secret changed between when the anon key was generated and now.
   Re-run `./generate-keys.sh` and update `.env` (anon + service role both).

### Tenant not auto-created on first signup

Confirm migration `030_create_tenants_trigger.sql` (or whichever introduces
`handle_new_user_tenancy()`) is in `_paycraft_migrations`. If not, re-run
`./migrations-bootstrap.sh`.

---

## 8. Updating

Upgrading to a newer PayCraft release on an existing self-hosted deployment:

```bash
# 1. Snapshot the database
docker exec paycraft_db pg_dump -U postgres -Fc postgres \
  > backups/paycraft-$(date +%Y%m%d-%H%M).dump

# 2. Pull the new release
git fetch --tags
git checkout v<NEW_VERSION>            # e.g. v2.1.0

# 3. Apply any new migrations (idempotent — only new files are applied)
cd infra/selfhost
./migrations-bootstrap.sh

# 4. Pull updated container images
docker compose pull

# 5. Recreate the dashboard with the new code (the volume mount is read-only,
#    so a rebuild + restart picks up the new ../../dashboard sources)
docker compose up -d --no-deps --build dashboard edge-runtime
```

The whole sequence is online — Kong, GoTrue, and Postgres stay up for the
duration. The dashboard is the only service that briefly restarts.

### Rolling back

```bash
# 1. Stop the stack
docker compose down

# 2. Restore the dump captured in Step 1 of the upgrade
docker volume rm selfhost_paycraft-db
docker compose up -d db
sleep 10
cat backups/paycraft-YYYYMMDD-HHMM.dump | \
  docker exec -i paycraft_db pg_restore -U postgres -d postgres --clean --if-exists

# 3. Check out the previous tag and re-up
git checkout v<PREVIOUS_VERSION>
docker compose up -d
```

Note: rolling back **does not** automatically reverse any migrations. If the
new release added a column the old code does not understand, the column simply
stays and is ignored. If it dropped or renamed a column, you need a hand-rolled
down migration — open a support ticket before attempting this.

---

## 9. Enterprise license

The contents of `infra/`, `server/`, `supabase/`, and `dashboard/` are licensed
under the Business Source License v1.1 — free for development, evaluation, and
non-production use; **production use requires an Enterprise license** from
MobileByteLabs.

- Pricing + terms: <https://paycraft.mobilebytesensei.com/enterprise>
- Contract & purchase: <mailto:enterprise@paycraft.mobilebytesensei.com>
- Per-deployment license file: drop into `infra/selfhost/LICENSE-ENTERPRISE.key`;
  the dashboard surfaces a validity banner on `/settings/license`.

The SDK (`cmp-paycraft/`) is and will always be Apache 2.0 — you can ship it
in your client apps with no commercial encumbrance.

---

## See also

- [`QUICK_START.md`](QUICK_START.md) — paycraft.mobilebytesensei.com SaaS quick start
- [`PROVIDERS.md`](PROVIDERS.md) — Stripe / Razorpay / Custom provider setup
- [`SECURITY.md`](SECURITY.md) — secret management and RLS model
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the stack fits together
- [`infra/selfhost/README.md`](../infra/selfhost/README.md) — terse 10-command quickstart
