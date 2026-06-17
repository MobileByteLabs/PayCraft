// dashboard/lib/sentry-events.ts
//
// Phase 4 of paycraft-v2-production-readiness — custom Sentry event builders
// for the most actionable failure modes. PII is masked at capture time per
// the global Sentry init in lib/sentry.client.ts.

import * as Sentry from "@sentry/nextjs"

export function captureFailedPayment(args: {
  tenantId: string
  provider: string
  reason: string
}): void {
  Sentry.withScope((scope) => {
    scope.setTag("tenant_id", args.tenantId)
    scope.setTag("provider", args.provider)
    scope.setTag("event", "payment_failed")
    Sentry.captureMessage(`payment_failed: ${args.reason}`, "error")
  })
}

export function captureWebhookRetry(args: {
  tenantId: string
  provider: string
  eventType: string
  attempt: number
}): void {
  Sentry.withScope((scope) => {
    scope.setTag("tenant_id", args.tenantId)
    scope.setTag("provider", args.provider)
    scope.setTag("event", "webhook_retry")
    scope.setContext("retry", { attempt: args.attempt, eventType: args.eventType })
    Sentry.captureMessage(`webhook_retry:${args.eventType}`, "warning")
  })
}

export function captureRateLimitHit(args: {
  tenantId: string | null
  route: string
  bucket: string
}): void {
  Sentry.withScope((scope) => {
    scope.setTag("tenant_id", args.tenantId ?? "unknown")
    scope.setTag("event", "rate_limit_hit")
    scope.setContext("rate_limit", { route: args.route, bucket: args.bucket })
    Sentry.captureMessage(`rate_limit_hit: ${args.route}`, "warning")
  })
}

export function captureKeyRotated(args: {
  tenantId: string
  userId?: string
  mode?: "test" | "live"
  reason?: string
}): void {
  Sentry.withScope((scope) => {
    scope.setTag("tenant_id", args.tenantId)
    scope.setTag("event", "api_key_rotated")
    if (args.mode) scope.setTag("mode", args.mode)
    const ctx: Record<string, unknown> = {}
    if (args.userId) ctx.user_id = args.userId
    if (args.reason) ctx.reason = args.reason
    if (Object.keys(ctx).length) scope.setContext("rotation", ctx)
    Sentry.captureMessage("api_key_rotated", "info")
  })
}
