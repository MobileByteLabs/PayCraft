// The decisions of `subscription-change`, kept pure so they are tested without a provider (see index.ts).

export interface CallerSubscription {
  provider: string
  provider_subscription_id: string | null
  plan: string
  pending_plan: string | null
  plan_changes_at: string | null
}
export interface PlanProduct {
  sku: string
  type: string
}

const CHANGEABLE = new Set(["stripe", "razorpay"])

const scheduled = (sub: CallerSubscription) => Boolean(sub.pending_plan && sub.plan_changes_at && Date.parse(sub.plan_changes_at) > Date.now())

/** "cancel-scheduled" when the member re-chooses their current plan while a change is scheduled (keep my plan). */
export function changeKind(sub: CallerSubscription, targetSku: string): "change" | "cancel-scheduled" {
  return scheduled(sub) && targetSku === sub.plan ? "cancel-scheduled" : "change"
}

/** Why this change cannot be made, or null when it can. */
export function refusal(sub: CallerSubscription | null, targetSku: string, target: PlanProduct | null): { error: string; status: number } | null {
  if (!sub) return { error: "no_subscription", status: 404 }
  if (changeKind(sub, targetSku) === "cancel-scheduled") return null
  if (!target) return { error: "plan_not_found", status: 404 }
  if (target.type !== "subscription") return { error: "not_a_subscription_plan", status: 409 }
  if (sub.plan === targetSku) return { error: "same_plan", status: 409 }
  if (!CHANGEABLE.has(sub.provider) || !sub.provider_subscription_id) return { error: "change_unsupported_for_provider", status: 501 }
  // ponytail: one scheduled change at a time; cancelling a scheduled Razorpay change is a later endpoint.
  if (scheduled(sub)) return { error: "change_already_scheduled", status: 409 }
  return null
}

/** The currency whose id in `map` is `id` (a product's price/plan ids are keyed by currency). */
export function currencyOf(map: Record<string, string> | null | undefined, id: string): string | null {
  const hit = Object.entries(map ?? {}).find(([, v]) => v === id)
  return hit ? hit[0].toUpperCase() : null
}

/** Stripe: swap the subscription's single item to the new price and invoice the prorated difference now. */
export function stripeChangeForm(itemId: string, priceId: string, sku: string): URLSearchParams {
  return new URLSearchParams({
    "items[0][id]": itemId,
    "items[0][price]": priceId,
    proration_behavior: "always_invoice",
    "metadata[plan_id]": sku,
  })
}

/** Razorpay: swap the plan at the end of the current cycle — mid-cycle proration is not documented. */
export function razorpayChangeBody(planId: string): { plan_id: string; schedule_change_at: "cycle_end" } {
  return { plan_id: planId, schedule_change_at: "cycle_end" }
}
