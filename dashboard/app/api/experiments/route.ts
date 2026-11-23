export const runtime = "edge"

// Paywall ▸ Experiments (migration 206). GET: the tenant's experiments + active offerings, or `?results=<key>` for one
// experiment's per-variant results. PUT: save a draft. POST { key, status }: start / stop. requireTenant() proves the
// caller administers the tenant; the RPCs are service-role only and own the rules — their exception codes come back
// as 400 { error: <code> }.

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { EXPERIMENT_ERROR_CODES, type ExperimentDraft, validateExperiment } from "@/lib/experiments"

const service = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

function rpcError(error: { message: string }) {
  const code = (EXPERIMENT_ERROR_CODES as readonly string[]).find((c) => c === error.message)
  return code
    ? NextResponse.json({ error: code }, { status: 400 })
    : NextResponse.json({ error: error.message }, { status: 500 })
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null

async function audit(tenantId: string, userId: string, action: string, key: string, after: unknown) {
  await createClient().rpc("audit_log_emit", {
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: action,
    p_resource: `paywall_experiments:key=${key}`,
    p_after: after,
  })
}

async function activeOfferingIds(tenantId: string): Promise<string[]> {
  const { data } = await createClient().from("tenant_offerings").select("id").eq("tenant_id", tenantId).eq("active", true)
  return (data ?? []).map((o: { id: string }) => o.id)
}

export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const key = req.nextUrl.searchParams.get("results")
  if (key) {
    const { data, error } = await service().rpc("paywall_experiment_results", { p_tenant_id: tenant.id, p_key: key })
    if (error) return rpcError(error)
    return NextResponse.json({ results: data ?? [] })
  }
  const supabase = createClient()
  const [experiments, offerings] = await Promise.all([
    supabase.from("paywall_experiments")
      .select("key,name,status,variants,started_at,stopped_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
    supabase.from("tenant_offerings").select("id,identifier,display_name").eq("tenant_id", tenant.id).eq("active", true),
  ])
  if (experiments.error) return NextResponse.json({ error: experiments.error.message }, { status: 500 })
  if (offerings.error) return NextResponse.json({ error: offerings.error.message }, { status: 500 })
  return NextResponse.json({ experiments: experiments.data, offerings: offerings.data })
}

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body: unknown = await req.json().catch(() => null)
  if (!isObj(body) || typeof body.key !== "string" || !Array.isArray(body.variants)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 })
  }
  const draft: ExperimentDraft = {
    key: body.key,
    name: typeof body.name === "string" ? body.name : "",
    variants: body.variants.map((v) => ({
      key: isObj(v) && typeof v.key === "string" ? v.key : "",
      weight: isObj(v) && typeof v.weight === "number" ? v.weight : NaN,
      offering_id: isObj(v) && typeof v.offering_id === "string" ? v.offering_id : "",
    })),
  }
  const problem = validateExperiment(draft, await activeOfferingIds(tenant.id))
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { data, error } = await service().rpc("paywall_experiment_save", {
    p_tenant_id: tenant.id,
    p_key: draft.key,
    p_name: draft.name,
    p_variants: draft.variants,
  })
  if (error) return rpcError(error)
  await audit(tenant.id, userId, "paywall_experiment.save", draft.key, data)
  return NextResponse.json({ experiment: data })
}

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body: unknown = await req.json().catch(() => null)
  if (!isObj(body) || typeof body.key !== "string" || (body.status !== "running" && body.status !== "stopped")) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 })
  }
  const { data, error } = await service().rpc("paywall_experiment_set_status", {
    p_tenant_id: tenant.id,
    p_key: body.key,
    p_status: body.status,
  })
  if (error) return rpcError(error)
  await audit(tenant.id, userId, `paywall_experiment.${body.status === "running" ? "start" : "stop"}`, body.key, data)
  return NextResponse.json({ experiment: data })
}
