/**
 * dashboard/playwright.config.ts
 *
 * Playwright configuration for the PayCraft dashboard e2e tests.
 * Local Supabase keys are resolved at config-eval time via `supabase status -o env`
 * so they are never hardcoded.
 */

import { defineConfig, devices } from "@playwright/test"
import { execSync } from "child_process"
import path from "path"

// ── Resolve local Supabase keys ───────────────────────────────────────────────
// `supabase status -o env` is run from the repo root (one level up from dashboard/).
// Output looks like: ANON_KEY=eyJ...\nSERVICE_ROLE_KEY=eyJ...\nAPI_URL=http://...\n
function resolveSupabaseEnv(): Record<string, string> {
  try {
    const repoRoot = path.resolve(__dirname, "..")
    const raw = execSync("supabase status -o env", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 15_000,
    })

    const env: Record<string, string> = {}
    for (const line of raw.split("\n")) {
      const eqIdx = line.indexOf("=")
      if (eqIdx === -1) continue
      const key = line.slice(0, eqIdx).trim()
      // Remove surrounding quotes if present
      const value = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
      env[key] = value
    }
    return env
  } catch (e) {
    // supabase CLI not running or not installed — fall back to well-known local demo JWTs
    console.warn(
      "[playwright.config] `supabase status -o env` failed — using fallback local demo keys.",
      (e as Error).message,
    )
    return {}
  }
}

const supabaseEnv = resolveSupabaseEnv()

// Map Supabase CLI env-var names → what the app + global-setup expect
const SUPABASE_URL =
  supabaseEnv["API_URL"] ??
  supabaseEnv["SUPABASE_URL"] ??
  "http://127.0.0.1:54321"

const ANON_KEY =
  supabaseEnv["ANON_KEY"] ??
  supabaseEnv["SUPABASE_ANON_KEY"] ??
  // Supabase CLI standard local demo anon key (safe to commit — not a real secret)
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqp8De5BB7bMjBqDzGUsFa1GRTTi3FNxo"

const SERVICE_ROLE_KEY =
  supabaseEnv["SERVICE_ROLE_KEY"] ??
  supabaseEnv["SUPABASE_SERVICE_ROLE_KEY"] ??
  // Supabase CLI standard local demo service key (safe to commit — not a real secret)
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hj04zWl196z2-SBc0"

// ── Config ─────────────────────────────────────────────────────────────────────
export default defineConfig({
  testDir: "./tests",
  // Matches only the v2 spec (avoids picking up __tests__/jest specs)
  testMatch: ["**/paywall-designer-v2.spec.ts"],

  // Global timeout per test
  timeout: 30_000,
  // Expect timeout for assertions
  expect: { timeout: 8_000 },

  // Retry once on CI to absorb flakiness
  retries: process.env.CI ? 1 : 0,

  // Single worker to avoid concurrent DB mutations from seed
  workers: 1,

  // Reporter
  reporter: process.env.CI ? "github" : "list",

  globalSetup: "./tests/global-setup.ts",

  use: {
    baseURL: "http://localhost:3000",
    storageState: "tests/.auth/state.json",
    // Capture trace on first retry for debugging
    trace: "on-first-retry",
    // Capture screenshot on failure
    screenshot: "only-on-failure",
    // Headless by default
    headless: true,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "node_modules/.bin/next dev -p 3000",
    url: "http://localhost:3000",
    // Re-use an already running Next.js server (common in dev)
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      // Supabase connection (both NEXT_PUBLIC_ and server-side)
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      // Also expose keys to global-setup (process.env is shared)
      SUPABASE_URL: SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
    },
  },
})
