/**
 * Reads that survive Stripe's API-version reshapes. A webhook payload is shaped by the ENDPOINT's
 * pinned api_version, so the same handler sees both shapes the day an endpoint is re-created or
 * re-pinned. Since 2025-03-31 (basil):
 *   - `current_period_start/end` moved from the Subscription onto each subscription item;
 *   - `invoice.subscription` moved to `invoice.parent.subscription_details.subscription`.
 * Reading only the old field gave `new Date(undefined * 1000)` → "Invalid time value" → a 500 that
 * Stripe retries until it disables the endpoint.
 */

import { attemptRow, type AttemptRow } from "./checkout-attempts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const toDate = (s: unknown): Date | null => (typeof s === "number" ? new Date(s * 1000) : null);

export function subscriptionPeriod(sub: Any): { start: Date | null; end: Date | null } {
  const item = sub?.items?.data?.[0];
  return {
    start: toDate(sub?.current_period_start ?? item?.current_period_start),
    end: toDate(sub?.current_period_end ?? item?.current_period_end),
  };
}

export function invoiceSubscriptionId(invoice: Any): string | null {
  const ref = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription ?? null;
  return typeof ref === "string" ? ref : ref?.id ?? null;
}

const refId = (x: Any): string | null => (typeof x === "string" ? x : x?.id ?? null);

/** Product behind a subscription / invoice, on both sides of the basil reshape. */
export function productIdOf(obj: Any): string | null {
  if (obj?.object === "subscription") return refId(obj.items?.data?.[0]?.price?.product);
  if (obj?.object === "invoice") {
    const line = obj.lines?.data?.[0];
    return refId(line?.price?.product ?? line?.pricing?.price_details?.product);
  }
  return null;
}

/** The slice of the Stripe client this needs — kept narrow so tests pass a fake. */
export interface StripeLookups {
  products: { retrieve(id: string): Promise<Any> };
  invoices: { retrieve(id: string): Promise<Any> };
  checkout: { sessions: { listLineItems(id: string, p: { limit: number }): Promise<Any> } };
}

/**
 * Which app a verified event belongs to, read from the event itself.
 *
 * One Stripe account can back several apps, and every endpoint on an account receives every app's
 * events — so a per-tenant URL would still be handed the other apps' events and cannot carry the tenant.
 * PayCraft stamps `paycraft_tenant_id` on what it creates: the checkout session + subscription
 * (checkout-initiate) and every synced product (product sync). The object's own metadata wins (for an
 * invoice, its subscription's); otherwise the product's. Null → the caller's existing resolver.
 * Safe to trust: the event is signature-verified, and only the account owner can write metadata.
 */
export async function stripeEventTenant(obj: Any, stripe: StripeLookups): Promise<string | null> {
  const direct = obj?.metadata?.paycraft_tenant_id ??
    // basil+ invoices carry their subscription's metadata here — no API call (and no wrong-account key) needed.
    obj?.parent?.subscription_details?.metadata?.paycraft_tenant_id;
  if (direct) return direct;

  let productId = productIdOf(obj);
  if (!productId && obj?.object === "checkout.session") {
    const items = await stripe.checkout.sessions.listLineItems(obj.id, { limit: 1 });
    productId = refId(items?.data?.[0]?.price?.product);
  }
  if (!productId && obj?.object === "charge" && obj.invoice) {
    productId = productIdOf(await stripe.invoices.retrieve(refId(obj.invoice)!));
  }
  if (!productId) return null;
  const product = await stripe.products.retrieve(productId);
  return product?.metadata?.paycraft_tenant_id ?? null;
}

/** A Stripe Checkout session that ended without a purchase (see _shared/checkout-attempts.ts). */
export function attemptFromSession(session: Any, outcome: AttemptRow["outcome"], tenantId: string | null): AttemptRow | null {
  return attemptRow({
    tenantId, provider: "stripe", mode: session?.livemode ? "live" : "test",
    email: session?.customer_details?.email || session?.customer_email,
    plan: session?.metadata?.plan_id ?? session?.metadata?.paycraft_plan, outcome, sessionId: session?.id,
  });
}
