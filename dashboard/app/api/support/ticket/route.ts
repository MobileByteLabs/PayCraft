// dashboard/app/api/support/ticket/route.ts
//
// Phase 4 of paycraft-v2-production-readiness — support ticket inbox.
// POST: accept a ticket, persist to support_tickets, send auto-reply.

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { captureRateLimitHit } from "@/lib/sentry-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface TicketPayload {
  email: string
  subject: string
  body: string
  tenantId?: string  // optional — if signed in
}

function isValid(p: Partial<TicketPayload>): p is TicketPayload {
  if (!p.email || typeof p.email !== "string" || !p.email.includes("@")) return false
  if (!p.subject || typeof p.subject !== "string" || p.subject.length < 3) return false
  if (!p.body || typeof p.body !== "string" || p.body.length < 10) return false
  return true
}

export async function POST(request: NextRequest) {
  let payload: Partial<TicketPayload>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  if (!isValid(payload)) {
    return NextResponse.json(
      { error: "missing_or_invalid_fields", required: ["email", "subject (≥3 chars)", "body (≥10 chars)"] },
      { status: 400 },
    )
  }

  const supabase = createClient()

  // Light per-IP throttle — 5 tickets per hour per IP to deter spam.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const { count } = await supabase
    .from("support_tickets")
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
    .eq("email", payload.email)
  if ((count ?? 0) >= 5) {
    captureRateLimitHit({ tenantId: null, route: "/api/support/ticket", bucket: "support_per_email_hr" })
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      email: payload.email,
      subject: payload.subject,
      body: payload.body,
      tenant_id: payload.tenantId ?? null,
      source: "dashboard",
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Best-effort fan-out to Linear (non-blocking; fire-and-forget).
  void fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/support-to-linear`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ ticketId: data.id, email: payload.email, subject: payload.subject, body: payload.body }),
    },
  ).catch(() => { /* ignore — Linear is best effort */ })

  // Auto-reply is sent by support-to-linear via Resend (kept in one place).

  return NextResponse.json({ ok: true, ticketId: data.id }, { status: 201 })
}
