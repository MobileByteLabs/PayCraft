// The Subscribers page reads tenant_customers_view (migration 186): web subscriptions, store buyers
// (Google Play / App Store) and checkout attempts that never became a subscription — one list of
// everyone who paid or tried. These are the rules the page applies to it.

export type CustomerRow = {
  row_id: string
  source: "subscription" | "store" | "attempt"
  email: string | null
  app_user_id: string | null
  plan: string | null
  provider: string | null
  status: string
  mode: string
  period_end: string | null
  started_at: string
  updated_at: string
}

/** One filter choice can mean several stored states — web `canceled`, store `cancelled`/`expired`, … */
export const STATUS_GROUPS: Record<string, string[]> = {
  active: ["active", "active_non_renewing", "in_grace_period", "on_billing_retry"],
  trialing: ["trialing", "trial"],
  churned: ["canceled", "cancelled", "expired", "refunded"],
  past_due: ["past_due", "on_billing_retry"],
  pending: ["pending", "incomplete"],
  abandoned: ["abandoned"],
  payment_failed: ["payment_failed"],
}

export function statusesFor(filter: string | undefined): string[] | null {
  return filter ? (STATUS_GROUPS[filter] ?? [filter]) : null
}

/** Search text goes inside a PostgREST `or(...)` expression, where `,` `(` `)` are syntax. */
export function searchTerm(q: string | undefined): string | null {
  const t = (q ?? "").replace(/[,()*%\\]/g, " ").trim()
  return t ? t : null
}

const PROVIDER_LABELS: Record<string, string> = {
  google_play: "Google Play",
  app_store: "App Store",
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
}

export function providerLabel(p: string | null): string {
  return p ? (PROVIDER_LABELS[p] ?? p) : "—"
}

/** Only web subscriptions have the detail page (/subscribers/[id] reads `subscriptions`). */
export function detailHref(r: Pick<CustomerRow, "source" | "row_id">): string | null {
  return r.source === "subscription" ? `/subscribers/${r.row_id}` : null
}

/** Who the row is: the email when known, else the store's app user id (an anonymous device). */
export function displayId(r: Pick<CustomerRow, "source" | "row_id" | "app_user_id">): string {
  return (r.app_user_id ?? r.row_id).slice(0, 10)
}
