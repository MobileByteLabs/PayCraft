# PayCraft Client Skills

These Claude skills automate PayCraft integration into any KMP client app.

## How to Add Skills to Your Project

1. Copy the `.md` files from this directory to your project's `.claude/commands/` directory:
   ```bash
   mkdir -p .claude/commands
   cp paycraft-setup.md .claude/commands/
   cp paycraft-verify.md .claude/commands/
   ```

2. Start a Claude Code session in your project
3. Run `/paycraft-setup` to integrate PayCraft

## Available Skills

| Skill | Purpose |
|-------|---------|
| `/paycraft-setup` | Full PayCraft integration — adds dependency, configures, wires DI, adds UI |
| `/paycraft-verify` | Verifies the PayCraft integration is correct and builds |

## Requirements

- PayCraft server must be set up (run `/setup` in the PayCraft library repo first)
- Your app must use Koin for DI
- Your app must use Compose Multiplatform

## What Gets Added to Your App

After `/paycraft-setup`:
- `io.github.mobilebytelabs:paycraft:1.0.0` dependency
- `PayCraft.configure {}` in your app initialization
- `PayCraftModule` in your Koin modules
- `PayCraftSheet` and `PayCraftRestore` in your SettingsScreen
- `BillingManager` injection wherever premium checks exist
