---
name: paycraft-run
description: Start PayCraft local dev environment — restart Supabase (picks up Google OAuth env vars) then start the Next.js dashboard on localhost:3000.
allowed-tools: Bash
---

# /paycraft-run

Start the PayCraft local dev environment.

## What it does
1. Stops any running Supabase local stack
2. Starts Supabase fresh (reads `supabase/.env` → Google OAuth config wired)
3. Starts the Next.js dashboard in background on `http://localhost:3000`

## Execution

### Step 1 — Resolve paths

```
FW=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
while [ "$FW" != "/" ] && [ ! -f "$FW/core/scripts/session-resolve.sh" ]; do FW=$(dirname "$FW"); done
PAYCRAFT_SRC="$FW/workspaces/mbs/PayCraft/source/PayCraft"
```

### Step 2 — Restart Supabase (blocking — wait for it to finish)

```bash
cd "$PAYCRAFT_SRC" && supabase stop ; supabase start
```

Use `run_in_background: false`. Print the full supabase start output so the user sees the API URL, anon key, etc.

### Step 3 — Start Next.js dashboard (long-running — run in background)

```bash
cd "$PAYCRAFT_SRC/dashboard" && npm run dev
```

Use `run_in_background: true`.

### Step 4 — Print summary

After both steps complete, print:

```
✅ Supabase  →  http://localhost:54321
✅ Dashboard →  http://localhost:3000  (starting…)

   Login:  http://localhost:3000/auth/login
   Studio: http://localhost:54323

Run /paycraft-stop to shut everything down.
```

## Notes

- `supabase stop` may exit non-zero if nothing was running — that is fine, continue.
- The dashboard takes ~5 seconds to compile after `npm run dev` starts; the browser will show a loading screen briefly.
- Google OAuth redirect is `http://localhost:54321/auth/v1/callback` — must be in Google Cloud Console authorized URIs.
