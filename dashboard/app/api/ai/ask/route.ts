import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { answer } from "@/lib/ai/engine"

export const runtime = "nodejs"

/**
 * PayCraft AI / Growth Copilot — tenant-facing answering endpoint.
 *
 * 100% deterministic: it answers FROM the PayCraft Brain (curated knowledge + lever rules)
 * plus the tenant's live analytics views. NO external/paid AI calls.
 *
 * POST { messages: [{ role, content }] }  (the last user message is answered)
 * → { text, proposals[] }   (proposals are confirm-gated — never auto-applied)
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  const body = await req.json().catch(() => ({}))
  const messages: { role: string; content: string }[] = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim()
  if (!lastUser) {
    return NextResponse.json({ error: "a user message is required" }, { status: 400 })
  }

  let result
  try {
    result = await answer(lastUser, supabase, tenant.id)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not answer right now." },
      { status: 500 },
    )
  }

  // Best-effort audit (never blocks the reply).
  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenant.id,
      p_actor_user_id: userId,
      p_actor_type: "user",
      p_action: "paycraft_ai.ask",
      p_resource: `tenants:id=${tenant.id}`,
      p_after: { proposals: result.proposals.length },
    })
    .then(undefined, () => {})

  return NextResponse.json(result)
}
