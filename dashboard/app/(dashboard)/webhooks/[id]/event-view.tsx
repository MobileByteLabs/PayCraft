"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard } from "@/components/query-ui"
import { EventClient, type WebhookEventView } from "./event-client"

/**
 * One webhook delivery — REAL, from webhook_logs, read in the browser (RLS-scoped).
 *
 * This is the drill-down from the delivery log, reached by clicking a row during incident triage, so it must
 * never show invented data. Tenant scoping is applied in the query, so a delivery id from another account
 * reads as not found rather than rendering.
 *
 * Fields webhook_logs does NOT record — processing time, the handler's response body, the retry history, the
 * endpoint and idempotency ids — are passed as null. The client states that they are not recorded rather than
 * filling the space, because a plausible-looking latency figure is worse than a visibly absent one.
 */
export function WebhookEventLoader({ id }: { id: string }) {
  const { tenantId, supabase } = useDashboard()
  const query = useQuery({
    queryKey: ["webhook-log", tenantId, id],
    queryFn: async (): Promise<WebhookEventView | null> => {
      const { data: log, error } = await supabase
        .from("webhook_logs")
        .select("id, provider, event_type, status, payload_redacted, error_message, created_at")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!log) return null
      return {
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
    },
  })

  if (query.isPending) return <LoadingCard label="Loading delivery…" rows={6} />
  if (query.isError) return <LoadError what="this delivery" error={query.error} retry={() => query.refetch()} />
  if (!query.data)
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-12 text-center">
        <h2 className="text-sm font-bold text-ink-700 mb-1">Delivery not found</h2>
        <p className="text-xs text-ink-500">
          It doesn&rsquo;t exist or belongs to another app.{" "}
          <Link href="/webhooks" className="font-semibold text-brand-600 hover:underline">
            Back to webhooks
          </Link>
        </p>
      </div>
    )
  return <EventClient event={query.data} />
}
