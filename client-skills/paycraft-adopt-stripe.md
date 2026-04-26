# /paycraft-adopt-stripe

Phase 3 of PayCraft adoption (Stripe path): creates test product, prices, payment links,
configures the webhook endpoint, verifies all 4 required events are subscribed, and
enables the customer portal. TEST MODE ONLY.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-stripe.md`

## Usage

Standalone: run this phase independently (e.g. to create live products after test setup,
or to add a new plan's price/payment link).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
