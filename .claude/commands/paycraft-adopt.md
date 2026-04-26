# /paycraft-adopt

End-to-end PayCraft adoption — from zero to verified billing in test mode.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt.md`

## What this does

Runs 5 phases in strict sequence:
1. ENV Bootstrap — .env setup + key validation
2. Supabase Setup — migrations + RPCs + webhook deployed + verified
3. Provider Setup — Stripe (test products/prices/links/webhook) or Razorpay
4. Client Integration — wires PayCraft into your KMP app
5. E2E Verification — live DB write test + RPC test + build check

## Sub-commands

| Command | Phase |
|---------|-------|
| `/paycraft-adopt-env` | Phase 1 only |
| `/paycraft-adopt-supabase` | Phase 2 only |
| `/paycraft-adopt-stripe` | Phase 3 (Stripe) only |
| `/paycraft-adopt-razorpay` | Phase 3B (Razorpay) only |
| `/paycraft-adopt-client` | Phase 4 only |
| `/paycraft-adopt-verify` | Phase 5 only |
