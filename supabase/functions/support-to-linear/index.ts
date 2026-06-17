// supabase/functions/support-to-linear/index.ts
//
// Phase 4 of paycraft-v2-production-readiness — forward a support ticket
// to Linear as an issue + send an auto-reply email via Resend.
//
// Triggered POST-only from dashboard/app/api/support/ticket/route.ts.
// Fail-soft: ticket persistence happens upstream; this function is
// best-effort fan-out. Returns 200 even on partial failure so the upstream
// fire-and-forget doesn't retry-storm.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { initSentry, captureWebhookEvent } from "../_shared/sentry.ts"

interface Payload {
  ticketId: string
  email: string
  subject: string
  body: string
}

const LINEAR_API_TOKEN = Deno.env.get("LINEAR_API_TOKEN")
const LINEAR_TEAM_ID = Deno.env.get("LINEAR_TEAM_ID")
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPPORT_FROM = Deno.env.get("SUPPORT_FROM") ?? "PayCraft Support <support@paycraft.mobilebytesensei.com>"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)

initSentry()

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response("invalid json", { status: 400 })
  }
  if (!payload?.ticketId || !payload?.email || !payload?.subject || !payload?.body) {
    return new Response("missing fields", { status: 400 })
  }

  // 1. Create Linear issue (best-effort)
  let linearUrl: string | null = null
  if (LINEAR_API_TOKEN && LINEAR_TEAM_ID) {
    try {
      const linearRes = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          authorization: LINEAR_API_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `mutation Create($i: IssueCreateInput!) { issueCreate(input: $i) { success issue { url id } } }`,
          variables: {
            i: {
              teamId: LINEAR_TEAM_ID,
              title: `[Support] ${payload.subject}`,
              description: `**From:** ${payload.email}\n\n${payload.body}\n\n---\nTicket ID: ${payload.ticketId}`,
            },
          },
        }),
      })
      const json = await linearRes.json()
      linearUrl = json?.data?.issueCreate?.issue?.url ?? null
      if (linearUrl) {
        await supabase
          .from("support_tickets")
          .update({ linear_issue_url: linearUrl })
          .eq("id", payload.ticketId)
      }
    } catch (e) {
      captureWebhookEvent({
        tenantId: null,
        provider: "linear",
        eventType: "issue_create_failed",
        isError: true,
        message: `linear_create_failed: ${(e as Error).message}`,
      })
    }
  }

  // 2. Send auto-reply via Resend (best-effort)
  if (RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: SUPPORT_FROM,
          to: [payload.email],
          subject: `Re: ${payload.subject}`,
          html: `<p>Thanks for reaching out — we received your ticket and the team will get back within 24 hours.</p>
            <p><strong>Ticket ID:</strong> ${payload.ticketId}</p>
            <p>You wrote:</p>
            <blockquote style="border-left:3px solid #ccc;padding-left:8px;color:#555">${
              payload.body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))
            }</blockquote>`,
        }),
      })
    } catch (e) {
      captureWebhookEvent({
        tenantId: null,
        provider: "resend",
        eventType: "support_autoreply_failed",
        isError: true,
        message: `resend_failed: ${(e as Error).message}`,
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, linearUrl }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
})
