export const runtime = "edge"

import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { EventClient, type WebhookEventView } from "./event-client"

/**
 * One webhook delivery — REAL, from webhook_logs.
 *
 * WHAT THIS REPLACES, and why it mattered more than the usual fixture. The page rendered a
 * module-level `MOCK_EVENT`: a successful `payment.succeeded` for `rahul.kumar@gmail.com`, with an
 * invented payload, an invented 200 response and an invented delivery history. Its own comment
 * said "real implementation would fetch from Supabase".
 *
 * This is the drill-down from the delivery log, so it is reached by clicking a row during
 * incident triage. Someone investigating a FAILED delivery landed on a fabricated SUCCESSFUL one
 * and could reasonably have concluded the webhook was fine. There is no worse moment to show
 * invented data than while someone is diagnosing why a customer paid and did not get access.
 *
 * Tenant scoping is applied in the query, so a delivery id from another account 404s rather than
 * rendering.
 *
 * Fields webhook_logs does NOT record — processing time, the handler's response body, the retry
 * history, the endpoint and idempotency ids — are passed as null. The client states that they are
 * not recorded rather than filling the space, because a plausible-looking latency figure is worse
 * than a visibly absent one.
 */
export default async function WebhookEventPage({ params }: { params: { id: string } }) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: log } = await supabase
    .from("webhook_logs")
    .select("id, provider, event_type, status, payload_redacted, error_message, created_at")
    .eq("tenant_id", tenant.id)
    .eq("id", params.id)
    .maybeSingle()

  if (!log) notFound()

  const event: WebhookEventView = {
    id: log.id as string,
    type: log.event_type as string,
    status: log.status as string,
    timestamp: log.created_at as string,
    provider: log.provider as string,
    // Payloads are stored REDACTED by the ingest pipeline, which is what makes this page safe to
    // screenshot into a support ticket.
    payload: log.payload_redacted,
    error_message: (log.error_message as string | null) ?? null,
    processing_ms: null,
    webhook_id: null,
    idempotency_key: null,
    response: null,
    delivery_history: [],
  }

  return <EventClient event={event} />
}
