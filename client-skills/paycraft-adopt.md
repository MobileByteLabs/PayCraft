<!--
  Runtime skill command is the single source of truth.
  Modify only in https://github.com/MobileByteLabs/PayCraft
  This stub contains zero logic — it bootstraps PayCraft location and loads the runtime.
-->

# /paycraft-adopt

End-to-end PayCraft billing adoption — from zero to verified billing in test mode.
Works from any KMP project directory. Handles PayCraft discovery and cloning automatically.

> Install this file: copy to `.claude/commands/paycraft-adopt.md` in your KMP app.
> Bootstrap (one prompt): see bottom of this file.

---

## STEP 0 — BOOTSTRAP (runs before phases, every time)

### 0A — Find or clone PayCraft

```
PROJECT_ROOT = current working directory (where Claude Code is opened = your KMP app root)

PAYCRAFT_ROOT candidates (check in order):
  1. Read {PROJECT_ROOT}/.env → PAYCRAFT_ROOT key
  2. Read {PROJECT_ROOT}/local.properties → PAYCRAFT_ROOT key
  3. {PROJECT_ROOT}/../paycraft/           (sibling directory)
  4. {PROJECT_ROOT}/../../paycraft/        (two levels up)
  5. ~/paycraft/                           (home directory)
  6. ~/Developer/paycraft/
  7. ~/code/paycraft/
  8. ~/projects/paycraft/
  9. {PROJECT_ROOT}/workspaces/mbs/PayCraft/   (claude-product-cycle framework workspace)

FOR EACH CANDIDATE:
  CHECK: {candidate}/server/migrations/001_create_subscriptions.sql exists?
  IF YES: paycraft_root = {candidate} → BREAK

IF NOT FOUND:
  DISPLAY:
    "PayCraft not found in common locations."
    ""
    "[1] Clone PayCraft now (recommended)"
    "    → git clone https://github.com/mobilebytelabs/paycraft ~/paycraft"
    ""
    "[2] Enter path to your existing PayCraft clone"
    ""
    "[3] What is PayCraft?"
    "    → PayCraft is a self-hosted KMP billing library that connects Stripe/Razorpay"
    "      to Supabase. It handles subscriptions so you don't have to."
    "      Repo: https://github.com/mobilebytelabs/paycraft"

  IF [1]:
    ASK: "Where should I clone PayCraft on your system?"
         "Suggested locations:"
         "  [A] ~/paycraft/           (home directory — simple)"
         "  [B] ~/Developer/paycraft/ (macOS developer convention)"
         "  [C] ~/code/paycraft/      (common code folder)"
         "  [D] Enter a custom path"
         "(Press Enter to accept suggestion [A])"
    WAIT: user picks A/B/C/D or presses Enter
    RESOLVE:
      A or Enter → CLONE_PATH = ~/paycraft
      B          → CLONE_PATH = ~/Developer/paycraft
      C          → CLONE_PATH = ~/code/paycraft
      D          → ASK: "Enter full path:" → CLONE_PATH = {entered path}
    DISPLAY: "Cloning PayCraft into {CLONE_PATH}..."
    ACTION: git clone https://github.com/mobilebytelabs/paycraft {CLONE_PATH}
    VERIFY: Exit code 0
    IF FAILS: HARD STOP — "Clone failed. Check internet + git.
                           Manual: git clone https://github.com/mobilebytelabs/paycraft {CLONE_PATH}"
    paycraft_root = {CLONE_PATH}
    WRITE: PAYCRAFT_ROOT={paycraft_root} to {PROJECT_ROOT}/.env
           (or local.properties if .env doesn't exist)
    OUTPUT: "✓ PayCraft cloned to: {paycraft_root}"

  IF [2]:
    ASK: "Path to PayCraft clone:"
    VALIDATE: {path}/server/migrations/001_create_subscriptions.sql exists
    IF INVALID: HARD STOP — "Not a valid PayCraft repo at: {path}
                              It should contain server/migrations/ and server/functions/"
    paycraft_root = {path}
    WRITE: PAYCRAFT_ROOT={paycraft_root} to {PROJECT_ROOT}/.env

  IF [3]:
    [show description then loop back to [1]/[2]]

OUTPUT: "✓ PayCraft: {paycraft_root}"
```

### 0B — Identify target app

```
TARGET_APP = PROJECT_ROOT (the directory where Claude Code is open)

VALIDATE: Contains libs.versions.toml OR build.gradle.kts OR settings.gradle.kts
IF VALID:
  DISPLAY: "✓ Target app: {PROJECT_ROOT}"

IF NOT VALID (Claude opened in a non-KMP directory, e.g. a docs folder):
  ASK: "This directory doesn't look like a KMP project."
       "Enter the path to your KMP app root:"
  VALIDATE: Directory contains Gradle files
  IF INVALID: HARD STOP — "Not a KMP project: {path}"
  target_app_path = {entered path}

ELSE:
  target_app_path = {PROJECT_ROOT}
```

### 0C — Derive ENV_PATH and load runtime

```
ENV_PATH derivation:
  IF target_app_path contains "/source/":
    ENV_PATH = everything before "/source/" + "/.env"
  ELSE:
    ENV_PATH = target_app_path + "/.env"

IF ENV_PATH does not exist:
  ACTION: Create ENV_PATH with PAYCRAFT_* key block
  OUTPUT: "✓ Created .env at {ENV_PATH}"
ELSE:
  CHECK: Does ENV_PATH contain PAYCRAFT_PROVIDER= line?
  IF NOT: Append PAYCRAFT_* key block to existing .env
  OUTPUT: "✓ .env found at {ENV_PATH}"

OUTPUT: "✓ PayCraft .env: {ENV_PATH}"
```

The runtime handles all setup phases, status display, and action menu — proceed directly.

---

```
Load: {paycraft_root}/layers/paycraft/commands/paycraft-adopt.md

Execute with pre-set variables:
  PAYCRAFT_ROOT   = {paycraft_root}
  TARGET_APP_PATH = {target_app_path}
  ENV_PATH        = {env_path}   ← ALL PAYCRAFT_* reads/writes use this file

The runtime will:
  • Scan .env + Supabase + client app → show status matrix
  • Display action menu: [A] Full setup / [B] Sandbox test / [C] Live test /
    [D] Keys guide / [E] Verify / [F] Fix phase / [Q] Quit
```

---

## Bootstrap — Install from anywhere (one prompt)

Paste this into Claude Code in your KMP project to install this command automatically:

```
Fetch the file at this URL and save it to .claude/commands/paycraft-adopt.md in this project:
https://raw.githubusercontent.com/MobileByteLabs/PayCraft/development/client-skills/paycraft-adopt.md

After saving, run /paycraft-adopt.
```

Claude will:
1. Fetch this file from GitHub
2. Create `.claude/commands/paycraft-adopt.md`
3. Immediately run `/paycraft-adopt` — which handles PayCraft discovery/cloning and wires billing into your app

No cloning required upfront. No switching directories.
