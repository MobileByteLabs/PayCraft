// supabase/functions/support-to-linear/index.ts
//
// Support ticket auto-reply via Resend. Ticket persistence happens upstream in
// dashboard/app/api/support/ticket/route.ts (Supabase `support_tickets` is the
// source of truth); this function is best-effort fan-out for the customer
// auto-reply only.
//
// NOTE: the Linear issue fan-out + Sentry edge telemetry were removed — tickets
// are triaged in the dashboard, not Linear. The function name is kept for URL
// stability (the dashboard caller invokes /functions/v1/support-to-linear).
//
// Triggered POST-only. Returns 200 even on partial failure so the upstream
// fire-and-forget doesn't retry-storm.

interface Payload {
  ticketId: string
  email: string
  subject: string
  body: string
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPPORT_FROM = Deno.env.get("SUPPORT_FROM") ?? "PayCraft Support <support@paycraft.mobilebytesensei.com>"

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

  // Send auto-reply via Resend (best-effort).
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
      console.error(
        JSON.stringify({ telemetry: "support_autoreply_failed", level: "error", reason: (e as Error).message }),
      )
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
})
