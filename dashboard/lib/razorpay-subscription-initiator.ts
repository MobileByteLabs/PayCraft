import { getConnectedRazorpayClient } from "./razorpay-client"

/**
 * Per-customer Razorpay Subscription creation for UPI Autopay.
 *
 * Unlike one-time Payment Links (which can be reused across customers), a
 * Razorpay Subscription is bound to a specific customer's mandate — so it's
 * created at CHECKOUT time, not at product-sync time. The product's Plan
 * (already created by razorpay-product-sync.ts) provides the recurring
 * amount + interval; the Subscription wraps it with a per-customer scope.
 *
 * Lifecycle the SDK observes:
 *   1. PayCraft server calls this fn → returns short_url
 *   2. SDK opens short_url in the customer's browser / WebView
 *   3. Customer picks UPI in Razorpay's hosted flow → authorizes mandate in
 *      their UPI app
 *   4. Razorpay's `subscription.authenticated` webhook fires → PayCraft
 *      flips status to `trialing` (if start_at > now) or `active`
 *   5. Recurring charges fire automatically; `subscription.charged` events
 *      extend `current_period_end` (handled in razorpay-webhook).
 *
 * `total_count` for a subscription represents the maximum number of charges
 * Razorpay will attempt before the subscription auto-completes. We pin
 * 120 (= 10 years of monthly billing) so the subscription effectively runs
 * forever; the customer / merchant can cancel earlier via the dashboard
 * or via subscription.cancel API.
 */

export interface CreateUpiAutopaySubscriptionArgs {
  tenantId: string
  planId: string                  // razorpay plan id from tenant_products.razorpay_plan_id_by_currency
  customerEmail: string
  customerName?: string | null
  customerPhone?: string | null
  productSku: string              // for paycraft_plan note (visible in webhook payload)
  productId: string               // for paycraft_product_id note
  /** Optional trial duration in seconds — Razorpay's start_at is "first charge time"; trial = created_at..start_at. */
  trialDurationDays?: number
  mode: "test" | "live"
  /** Defaults to 120 (≈10 years monthly). Razorpay caps at 1000. */
  totalCount?: number
}

export interface CreateUpiAutopaySubscriptionResult {
  subscriptionId: string
  shortUrl: string                // customer-facing URL to authorize the mandate
  status: string                  // razorpay returns "created" initially
}

export async function createUpiAutopaySubscription(
  args: CreateUpiAutopaySubscriptionArgs,
): Promise<CreateUpiAutopaySubscriptionResult> {
  const client = await getConnectedRazorpayClient(args.tenantId, args.mode)

  const now = Math.floor(Date.now() / 1000)
  const startAt =
    args.trialDurationDays && args.trialDurationDays > 0
      ? now + args.trialDurationDays * 86_400
      : undefined

  const payload: Record<string, unknown> = {
    plan_id: args.planId,
    total_count: args.totalCount ?? 120,
    customer_notify: 1,
    notify_info: {
      notify_email: args.customerEmail,
      ...(args.customerPhone ? { notify_phone: args.customerPhone } : {}),
    },
    // Razorpay's notes are echoed back in webhook payloads — the
    // razorpay-webhook handler reads `paycraft_email`, `paycraft_plan`,
    // `paycraft_mode` to route the event to the right tenant/subscription.
    notes: {
      paycraft_tenant_id: args.tenantId,
      paycraft_product_id: args.productId,
      paycraft_plan: args.productSku,
      paycraft_email: args.customerEmail,
      paycraft_mode: args.mode,
      paycraft_customer_name: args.customerName ?? "",
    },
  }
  if (startAt) payload.start_at = startAt

  // The `client.subscriptions.create()` typing is loose in the razorpay SDK;
  // cast to any to access the dynamic surface while keeping type-safety at
  // the args boundary.
  const sub = await (client as any).subscriptions.create(payload)

  if (!sub?.id || !sub?.short_url) {
    throw new Error(
      `Razorpay create-subscription returned malformed response: ${JSON.stringify(sub)}`,
    )
  }

  return {
    subscriptionId: sub.id as string,
    shortUrl: sub.short_url as string,
    status: (sub.status as string) ?? "created",
  }
}
