// The decisions of `subscription-cancel`, kept pure so they are tested without a provider (see index.ts).

export interface CancelSubscription {
  provider: string
  provider_subscription_id: string | null
  cancel_at_period_end: boolean | null
}

const CANCELLABLE = new Set(["stripe", "razorpay"])
const STORES = new Set(["google_play", "app_store"])

/** Why this subscription cannot be cancelled here, or null when it can. */
export function cancelRefusal(sub: CancelSubscription | null): { error: string; status: number } | null {
  if (!sub) return { error: "no_subscription", status: 404 }
  if (STORES.has(sub.provider)) return { error: "cancel_in_store", status: 501 }
  if (!CANCELLABLE.has(sub.provider) || !sub.provider_subscription_id) return { error: "cancel_unsupported_for_provider", status: 501 }
  if (sub.cancel_at_period_end) return { error: "already_cancelled", status: 409 }
  return null
}

/** Stripe: stop renewing; the member keeps the plan they paid for until the period ends. */
export function stripeCancelForm(): URLSearchParams {
  return new URLSearchParams({ cancel_at_period_end: "true" })
}

/** Razorpay: cancel at the end of the current billing cycle (same promise as Stripe). */
export function razorpayCancelBody(): { cancel_at_cycle_end: 1 } {
  return { cancel_at_cycle_end: 1 }
}
