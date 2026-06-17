import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export const runtime = "nodejs"
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
      return { name: "supabase", ok: false, detail: error.message, duration_ms: Date.now() - start }
    }
    return { name: "supabase", ok: true, duration_ms: Date.now() - start }
  } catch (e) {
    return {
      name: "supabase",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
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
  return {
    name: "env",
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
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
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      env: process.env.VERCEL_ENV ?? "local",
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
