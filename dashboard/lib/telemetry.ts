// dashboard/lib/telemetry.ts
//
// Lightweight server-side operational telemetry. Replaces the former Sentry
// event builders (lib/sentry-events.ts) — structured single-line JSON lands in
// Vercel runtime logs at zero cost and with no external dependency.
// Never logs PII: tenant ids + non-identifying tags only.

type Level = "info" | "warning" | "error"

function emit(event: string, level: Level, fields: Record<string, unknown>): void {
  // Drop undefined fields so log lines stay clean.
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v
  const line = JSON.stringify({ telemetry: event, level, ...clean })
  if (level === "error") console.error(line)
  else if (level === "warning") console.warn(line)
  else console.log(line)
}

export function captureFailedPayment(args: {
  tenantId: string
  provider: string
  reason: string
}): void {
  emit("payment_failed", "error", {
    tenant_id: args.tenantId,
    provider: args.provider,
    reason: args.reason,
  })
}

export function captureWebhookRetry(args: {
  tenantId: string
  provider: string
  eventType: string
  attempt: number
}): void {
  emit("webhook_retry", "warning", {
    tenant_id: args.tenantId,
    provider: args.provider,
    event_type: args.eventType,
    attempt: args.attempt,
  })
}

export function captureRateLimitHit(args: {
  tenantId: string | null
  route: string
  bucket: string
}): void {
  emit("rate_limit_hit", "warning", {
    tenant_id: args.tenantId ?? "unknown",
    route: args.route,
    bucket: args.bucket,
  })
}

export function captureKeyRotated(args: {
  tenantId: string
  userId?: string
  mode?: "test" | "live"
  reason?: string
}): void {
  emit("api_key_rotated", "info", {
    tenant_id: args.tenantId,
    user_id: args.userId,
    mode: args.mode,
    reason: args.reason,
  })
}
