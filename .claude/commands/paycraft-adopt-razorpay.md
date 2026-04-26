# /paycraft-adopt-razorpay

Phase 3B of PayCraft adoption (Razorpay path): creates subscription plans, payment links,
and configures the webhook endpoint. Runs INSTEAD of Phase 3 when PAYCRAFT_PROVIDER=razorpay.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-razorpay.md`

## Usage

Standalone: run this phase independently (e.g. to add a new plan or rotate webhook secret).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
