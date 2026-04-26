# /paycraft-adopt-env

Phase 1 of PayCraft adoption: ENV bootstrap — creates `.env` from `.env.example`,
collects all credentials (Supabase, provider, plans, support email), and validates
every key before proceeding.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-env.md`

## Usage

Standalone: run this phase independently (e.g. to re-collect credentials after key rotation).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
