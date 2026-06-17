// supabase/functions/_shared/sentry.ts
//
// Phase 4 of paycraft-v2-production-readiness — Sentry init + tenant tag
// helper for edge function handlers. PII-masked (no email/PAN/full IPs).

import * as Sentry from "https://esm.sh/@sentry/deno@8.0.0"

let initialized = false

export function initSentry(): void {
  if (initialized) return
  const dsn = Deno.env.get("SENTRY_DSN")
  if (!dsn) return  // Sentry is optional; absence = degraded observability, not crash
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "local",
  })
  initialized = true
}

/** Sets `tenant_id` tag on the current Sentry scope so every event groups by tenant. */
export function setTenantContext(tenantId: string | null): void {
  initSentry()
  Sentry.setTag("tenant_id", tenantId ?? "unknown")
}

/** Sets `provider` tag (stripe/razorpay/etc.) on the current scope. */
export function setProviderContext(provider: string): void {
  initSentry()
  Sentry.setTag("provider", provider)
}

/** Captures a webhook event for observability. Severity governed by isError. */
export function captureWebhookEvent(args: {
  tenantId: string | null
  provider: string
  eventType: string
  isError?: boolean
  message?: string
}): void {
  initSentry()
  setTenantContext(args.tenantId)
  setProviderContext(args.provider)
  if (args.isError) {
    Sentry.captureMessage(args.message ?? `webhook_error:${args.eventType}`, "error")
  } else {
    Sentry.addBreadcrumb({
      category: "webhook",
      message: args.eventType,
      level: "info",
      data: { provider: args.provider },
    })
  }
}

export { Sentry }
