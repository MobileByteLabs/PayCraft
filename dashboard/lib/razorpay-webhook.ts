/**
 * Razorpay webhook registration — PayCraft's job, the way Stripe's is (the connect callback calls
 * `webhookEndpoints.create`).
 *
 * Until 2026-11-13 the merchant typed the URL into Razorpay's dashboard by hand. The shared org test
 * account pointed at a dashboard route that does not exist (404) and the live account at the bare
 * function URL, which the function then refused — so no Razorpay delivery had ever reached PayCraft.
 *
 * ONE account-level URL, no tenant segment: several apps can share one Razorpay account (PSP account
 * tier, migration 112), a webhook URL can name only one of them, and `razorpay-webhook` now takes the
 * app from the event notes (checkout-initiate stamps `paycraft_tenant_id`) and verifies the signature
 * with THAT app's secret. A per-app URL registered earlier still counts as registered.
 */

/** Every event PayCraft's handler acts on: each subscription state, one-time payments and refunds. */
export const RAZORPAY_WEBHOOK_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
  "subscription.updated",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment_link.paid",
  "refund.processed",
] as const

export interface RazorpayWebhookRow {
  id: string
  url: string
  active?: boolean
  events?: Record<string, boolean> | string[]
}

/** The slice of the Razorpay REST client this needs (`razorpayRest(...).webhooks`). */
export interface RazorpayWebhookClient {
  webhooks: {
    all(): Promise<{ items?: RazorpayWebhookRow[] } | RazorpayWebhookRow[]>
    create(payload: Record<string, unknown>): Promise<RazorpayWebhookRow>
  }
}

export type EnsureResult = {
  status: "ok" | "created" | "inactive" | "secret_missing" | "error"
  url: string
  id?: string
  missingEvents: string[]
  message?: string
}

export function razorpayWebhookUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/razorpay-webhook`
}

/** Events PayCraft needs that this webhook does not send. Razorpay returns either a map or a list. */
export function webhookCoverage(events: RazorpayWebhookRow["events"]): string[] {
  const on = new Set(
    Array.isArray(events) ? events : Object.entries(events ?? {}).filter(([, v]) => v).map(([k]) => k),
  )
  return RAZORPAY_WEBHOOK_EVENTS.filter((e) => !on.has(e))
}

/** The account URL, or a per-app URL (`/razorpay-webhook/{tenant}`) registered before 2026-11-13. */
export function isPayCraftWebhook(url: string, supabaseUrl: string, tenantId?: string): boolean {
  const base = razorpayWebhookUrl(supabaseUrl)
  return url === base || (!!tenantId && url === `${base}/${tenantId}`)
}

/**
 * Make sure the Razorpay account behind [client] sends PayCraft its events. Idempotent: an existing
 * PayCraft webhook is reported (with any missing events), never duplicated. Never throws — a failure
 * comes back as `status: "error"` so a key save is not undone by it (same as the Stripe callback).
 */
export async function ensureRazorpayWebhook(
  client: RazorpayWebhookClient,
  opts: { supabaseUrl: string; secret: string; alertEmail?: string; tenantId?: string },
): Promise<EnsureResult> {
  const url = razorpayWebhookUrl(opts.supabaseUrl)
  try {
    const listed = await client.webhooks.all()
    const rows = Array.isArray(listed) ? listed : (listed.items ?? [])
    const mine = rows.find((w) => isPayCraftWebhook(w.url, opts.supabaseUrl, opts.tenantId))
    if (mine) {
      return {
        status: mine.active === false ? "inactive" : "ok",
        url: mine.url,
        id: mine.id,
        missingEvents: webhookCoverage(mine.events),
      }
    }
    // Razorpay signs every delivery with this secret, and the function verifies with the one PayCraft
    // stores — registering without it would produce a webhook nothing can verify.
    if (!opts.secret) return { status: "secret_missing", url, missingEvents: [...RAZORPAY_WEBHOOK_EVENTS] }
    const created = await client.webhooks.create({
      url,
      secret: opts.secret,
      ...(opts.alertEmail ? { alert_email: opts.alertEmail } : {}),
      events: Object.fromEntries(RAZORPAY_WEBHOOK_EVENTS.map((e) => [e, true])),
    })
    return { status: "created", url, id: created.id, missingEvents: [] }
  } catch (e) {
    return { status: "error", url, missingEvents: [], message: (e as Error)?.message ?? "Razorpay API error" }
  }
}
