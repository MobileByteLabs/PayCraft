# /paycraft-adopt-verify

Phase 5 of PayCraft adoption: end-to-end verification — re-verifies schema (9 individual
queries), confirms webhook signature secrets, writes a real test row via service role,
calls `is_premium()` and `get_subscription()` via anon key, cleans up, verifies all
payment links, and runs a Gradle compile check. HARD STOP on any failure.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-verify.md`

## Usage

```
/paycraft-adopt-verify           # mode from PAYCRAFT_MODE in .env (default)
/paycraft-adopt-verify test      # force test-mode verification regardless of .env
/paycraft-adopt-verify live      # force live-mode verification regardless of .env
```

- `test` — verifies PAYCRAFT_STRIPE_TEST_* keys, test payment links, mode='test' DB rows
- `live` — verifies PAYCRAFT_STRIPE_LIVE_* keys, live payment links, mode='live' DB rows
- Omitting the arg falls back to PAYCRAFT_MODE in .env (default: "test")

Standalone: run this phase independently to re-verify after key rotation or config change.
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
