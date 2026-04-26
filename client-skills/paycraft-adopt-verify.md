# /paycraft-adopt-verify

Phase 5 of PayCraft adoption: end-to-end verification — re-verifies schema (4 individual
queries), confirms webhook returns 400 unsigned, writes a real test row via service role,
calls `is_premium()` and `get_subscription()` via anon key, cleans up, verifies all
payment links, and runs a Gradle compile check. HARD STOP on any failure.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-verify.md`

## Usage

Standalone: run this phase independently to re-verify after key rotation or config change.
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
