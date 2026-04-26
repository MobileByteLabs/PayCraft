# /paycraft-adopt-supabase

Phase 2 of PayCraft adoption: Supabase setup — applies database migrations,
creates RPCs (`is_premium`, `get_subscription`), deploys the webhook Edge Function,
and verifies every step with inline checks.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-supabase.md`

## Usage

Standalone: run this phase independently (e.g. to re-deploy the webhook or re-apply migrations).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
