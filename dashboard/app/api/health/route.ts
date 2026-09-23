import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export const runtime = "edge"
export const dynamic = "force-dynamic"
export const revalidate = 0

type HealthCheck = {
  name: string
  ok: boolean
  detail?: string
  duration_ms?: number
}

async function checkSupabase(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const supabase = createClient()
    const { error } = await supabase
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .limit(1)
    if (error) {
      const detail =
        error.message ||
        [error.code, error.details, error.hint].filter(Boolean).join(" | ") ||
        JSON.stringify(error)
      console.error("[health] supabase query error:", detail, error)
      return { name: "supabase", ok: false, detail, duration_ms: Date.now() - start }
    }
    return { name: "supabase", ok: true, duration_ms: Date.now() - start }
  } catch (e) {
    const detail =
      e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e) || String(e)
    console.error("[health] supabase threw:", detail, e)
    return {
      name: "supabase",
      ok: false,
      detail,
      duration_ms: Date.now() - start,
    }
  }
}

function checkEnv(): HealthCheck {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    // The NAMES go to the log; the COUNT goes to the caller. /api/health is public and
    // unauthenticated, so naming the variables here would publish which part of our infrastructure
    // is misconfigured at exactly the moment it is — the worst possible time to be specific in
    // public. Whoever is on call reads the log and gets the full list immediately.
    console.error(`health: missing required env — ${missing.join(", ")}`)
  }
  return {
    name: "env",
    ok: missing.length === 0,
    detail: missing.length ? `${missing.length} required variable(s) not set` : undefined,
  }
}

export async function GET() {
  const startedAt = Date.now()
  const checks = await Promise.all([Promise.resolve(checkEnv()), checkSupabase()])
  const allOk = checks.every((c) => c.ok)

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      service: "paycraft-dashboard",
      version: process.env.CF_VERSION_METADATA_ID?.slice(0, 7) ?? "dev",
      env: process.env.NEXT_PUBLIC_APP_ENV ?? "local",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      checks,
    },
    { status: allOk ? 200 : 503 },
  )
}

export async function HEAD() {
  // Lightweight liveness probe — no DB check, just confirm the route is mounted
  return new Response(null, { status: 200 })
}
