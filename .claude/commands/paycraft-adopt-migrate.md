# /paycraft-adopt-migrate

Migrate an existing PayCraft deployment to a new Supabase project, new Stripe/Razorpay
account, or switch payment providers. Backs up `.env` and deployment state before any change.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-migrate.md`

## Migration types

| Option | What changes |
|--------|-------------|
| `[1] Supabase only` | New Supabase project — re-deploys migrations + webhook, migrates subscriber data |
| `[2] Stripe only` | New Stripe account — re-creates products, prices, payment links, webhook |
| `[3] Razorpay only` | New Razorpay account — re-creates plans, payment links, webhook |
| `[4] Both` | New Supabase + new payment provider account |
| `[5] Switch provider` | Stripe ↔ Razorpay — deploys new provider, updates app config |

## Usage

Run from the project that has PayCraft deployed (`.paycraft/deployment.json` must exist).
Standalone: `/paycraft-adopt-migrate`
Full setup: run `/paycraft-adopt` first, then migrate as needed.
