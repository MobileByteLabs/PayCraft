# PayCraft self-host (Enterprise tier)

Single-machine deployment of the entire PayCraft platform — Postgres + Auth +
Edge functions + Dashboard. Ships with `docker compose` so it boots in <10
commands.

## Quick start (10 commands)

```bash
cd infra/selfhost

# 1. Copy + edit env (DB password + Stripe Connect platform credentials)
cp .env.example .env
$EDITOR .env

# 2. Generate JWT-derived keys
./generate-keys.sh > .env.generated
cat .env.generated >> .env

# 3. Boot core services
docker compose up -d db auth kong

# 4. Apply migrations
./migrations-bootstrap.sh

# 5. Boot edge runtime + dashboard
docker compose up -d edge-runtime dashboard

# 6. Open the dashboard
open http://localhost:3000
```

## Sign up + provision first tenant

The first user who signs up is auto-promoted to `owner` of a fresh tenant. After
that, every dashboard page exists and the SDK can be wired:

```kotlin
PayCraft.initialize(
  apiKey = "pk_live_…",                  // from dashboard /settings/api-keys
  backend = PayCraftBackend.SelfHosted(
    supabaseUrl     = "https://billing.acme.com",
    supabaseAnonKey = "<your PAYCRAFT_ANON_KEY>"
  )
)
PayCraftPaywall()
```

## Upgrades

```bash
git pull
./migrations-bootstrap.sh                # idempotent — only applies new migrations
docker compose pull
docker compose up -d --no-deps --build dashboard
```

## Licensing

The server side (this `infra/`, `server/`, `supabase/`, `dashboard/`) is under
Business Source License v1.1. Production use requires an Enterprise license
from MobileByteSensei. See LICENSE-SELFHOST.md.
