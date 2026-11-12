/**
 * Checkouts that ended without a purchase — the "tried" rows of the customer list (checkout_attempts,
 * migration 186; dashboard Subscribers page). One shape for every web provider:
 *
 *   stripe    checkout.session.expired → abandoned · checkout.session.async_payment_failed → payment_failed
 *   razorpay  payment_link.expired / .cancelled → abandoned · payment.failed → payment_failed
 *   cashfree  PAYMENT_USER_DROPPED_WEBHOOK → abandoned · PAYMENT_FAILED_WEBHOOK → payment_failed
 *
 * A row needs an app and an email: a NULL-tenant row would surface in no app's list, and a buyer who
 * left before giving an email is a page view, not someone the merchant can follow up.
 */

// deno-lint-ignore no-explicit-any
type Any = any;

export interface AttemptRow {
  tenant_id: string;
  provider: string;
  mode: "live" | "test";
  email: string;
  plan: string | null;
  outcome: "abandoned" | "payment_failed";
  provider_session_id: string;
}

export function attemptRow(i: {
  tenantId: string | null | undefined;
  provider: string;
  mode: "live" | "test";
  email: string | null | undefined;
  plan: string | null | undefined;
  outcome: AttemptRow["outcome"];
  sessionId: string | null | undefined;
}): AttemptRow | null {
  const email = (i.email ?? "").trim().toLowerCase();
  if (!i.tenantId || !email || !i.sessionId) return null;
  return {
    tenant_id: i.tenantId,
    provider: i.provider,
    mode: i.mode,
    email,
    plan: i.plan ?? null,
    outcome: i.outcome,
    provider_session_id: i.sessionId,
  };
}

/**
 * Razorpay echoes the notes PayCraft set at creation (checkout-initiate / razorpay-product-sync) on
 * every webhook, so the app comes from `paycraft_tenant_id` when the webhook URL does not carry one.
 */
export function razorpayAttempt(eventType: string, payload: Any, pathTenantId: string | null, mode: "live" | "test"): AttemptRow | null {
  if (eventType === "payment.failed") {
    const p = payload?.payment?.entity;
    const notes = p?.notes ?? {};
    return attemptRow({
      tenantId: pathTenantId ?? notes.paycraft_tenant_id, provider: "razorpay", mode,
      email: p?.email || notes.paycraft_email, plan: notes.paycraft_plan, outcome: "payment_failed", sessionId: p?.id,
    });
  }
  if (eventType === "payment_link.expired" || eventType === "payment_link.cancelled") {
    const l = payload?.payment_link?.entity;
    const notes = l?.notes ?? {};
    return attemptRow({
      tenantId: pathTenantId ?? notes.paycraft_tenant_id, provider: "razorpay", mode,
      email: l?.customer?.email || notes.paycraft_email, plan: notes.paycraft_plan, outcome: "abandoned", sessionId: l?.id,
    });
  }
  return null;
}

/** Idempotent: a provider redelivering the same event updates the same row. */
export async function recordAttempt(supabase: Any, row: AttemptRow): Promise<void> {
  const { error } = await supabase.from("checkout_attempts").upsert(row, { onConflict: "provider,provider_session_id" });
  if (error) throw new Error(`checkout_attempts write failed: ${error.message}`);
}
