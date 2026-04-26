# /paycraft-adopt-client

Phase 4 of PayCraft adoption: client integration — adds the PayCraft dependency to Gradle,
generates `PayCraft.configure()` with correct references, adds `PayCraftModule` to Koin,
wires the paywall UI into your SettingsScreen, and stores API keys securely.

## Full instructions

See `layers/paycraft/commands/paycraft-adopt-client.md`

## Usage

Standalone: run this phase independently (e.g. to integrate into a second app, or after
updating payment links).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
