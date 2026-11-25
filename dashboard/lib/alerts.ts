// The owner alerts inbox (paycraft-attempt-observability GOAL D8 / AC-16): `tenant_alerts` (migration 211) is the
// record of every alert, stored before any channel is tried; `alert_deliveries` is what each channel did with it.
// Admins read their own tenant's rows and may only set read_at (RLS + column grant). Weekly AI insights (sub-plan
// 06) are kind 'ai_insight' and render in their own section.

import type { SupabaseClient } from "@supabase/supabase-js"
import { redactUrls } from "@/lib/alert-channels"

export type AlertSeverity = "critical" | "digest"
export type AlertFilter = "all" | "critical" | "digest" | "unread"
export const ALERT_FILTERS: readonly AlertFilter[] = ["all", "unread", "critical", "digest"]

export type AlertDelivery = {
  channel: "email" | "slack" | "webhook" | "inbox"
  status: "pending" | "sent" | "failed"
  attempts: number
  http_status: number | null
  error: string | null
}

export type AlertRow = {
  id: string
  kind: string
  severity: AlertSeverity
  title: string
  body: string
  stage: string | null
  code: string | null
  correlation: "exact" | "inferred" | null
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
  deliveries: AlertDelivery[]
}

export const INSIGHT_KIND = "ai_insight"
export const INBOX_CAP = 200

export const ALERT_KIND_LABEL: Record<string, string> = {
  paid_not_granted: "Paid, not granted",
  webhook_sig_fail: "Webhook signature failures",
  webhook_proc_fail: "Webhook processing failures",
  failure_rate_spike: "Failure-rate spike",
  abandon_digest: "Abandoned checkouts",
  decline_digest: "Declined payments",
  limit_warn: "Subscriber limit warning",
  limit_hit: "Subscriber limit reached",
  webhook_fail: "Webhook delivery failure",
  sub_expiry: "Subscriptions expiring",
  ai_insight: "Weekly insight",
  channel_test: "Channel test",
}
export const alertKindLabel = (kind: string) => ALERT_KIND_LABEL[kind] ?? kind.replace(/_/g, " ")

/** Unread first, newest first inside each group (stable, so equal timestamps keep the query's order). */
export function inboxOrder<T extends { read_at: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ua = a.read_at === null ? 0 : 1
    const ub = b.read_at === null ? 0 : 1
    if (ua !== ub) return ua - ub
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
}

/** The inbox list (insights excluded — they have their own section), with each alert's deliveries. */
export async function fetchAlerts(sb: SupabaseClient, tenantId: string, filter: AlertFilter): Promise<AlertRow[]> {
  let q = sb
    .from("tenant_alerts")
    .select("id, kind, severity, title, body, stage, code, correlation, payload, created_at, read_at")
    .eq("tenant_id", tenantId)
    .neq("kind", INSIGHT_KIND)
  if (filter === "critical" || filter === "digest") q = q.eq("severity", filter)
  if (filter === "unread") q = q.is("read_at", null)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(INBOX_CAP)
  if (error) throw new Error(`tenant_alerts: ${error.message}`)
  const alerts = (data ?? []) as Omit<AlertRow, "deliveries">[]
  const deliveries = new Map<string, AlertDelivery[]>()
  if (alerts.length) {
    const { data: d, error: dErr } = await sb
      .from("alert_deliveries")
      .select("alert_id, channel, status, attempts, http_status, error")
      .in("alert_id", alerts.map((a) => a.id))
    if (dErr) throw new Error(`alert_deliveries: ${dErr.message}`)
    for (const row of (d ?? []) as (AlertDelivery & { alert_id: string })[]) {
      const list = deliveries.get(row.alert_id) ?? []
      list.push({ channel: row.channel, status: row.status, attempts: row.attempts, http_status: row.http_status, error: redactUrls(row.error) })
      deliveries.set(row.alert_id, list)
    }
  }
  return inboxOrder(alerts.map((a) => ({ ...a, deliveries: deliveries.get(a.id) ?? [] })))
}

export type InsightRow = { id: string; title: string; body: string; created_at: string; read_at: string | null; payload: Record<string, unknown> }

/** Weekly AI insights (sub-plan 06 writes them), newest first. */
export async function fetchInsights(sb: SupabaseClient, tenantId: string, limit = 12): Promise<InsightRow[]> {
  const { data, error } = await sb
    .from("tenant_alerts")
    .select("id, title, body, created_at, read_at, payload")
    .eq("tenant_id", tenantId)
    .eq("kind", INSIGHT_KIND)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`tenant_alerts insights: ${error.message}`)
  return (data ?? []) as InsightRow[]
}

export type UnreadCounts = { total: number; critical: number }

/** The sidebar badge: unread alerts, and how many of them are critical (the pill turns red). */
export async function unreadCounts(sb: SupabaseClient, tenantId: string): Promise<UnreadCounts> {
  const base = () => sb.from("tenant_alerts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("read_at", null)
  const [all, critical] = await Promise.all([base(), base().eq("severity", "critical")])
  return { total: all.count ?? 0, critical: critical.count ?? 0 }
}
