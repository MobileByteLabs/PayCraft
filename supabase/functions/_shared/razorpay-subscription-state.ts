/**
 * A Razorpay subscription event → the PayCraft subscription state it means. Pure, so the lifecycle is
 * testable without a webhook.
 *
 * Razorpay: created → authenticated (mandate + upfront amount) → active (at start_at) → charged…
 * With a trial, start_at is in the future and the subscription sits in `authenticated` for the whole
 * trial; `subscription.activated` fires only when the trial ENDS. Until 2026-11-13 `authenticated` was
 * ignored, so a buyer who started a trial had no access until it was over — Stripe grants access while
 * `trialing`. Statuses match the Stripe lane (`active | trialing | past_due | paused | canceled`); only
 * `active` and `trialing` count as premium (migration 177).
 */
export interface RazorpaySubEntity {
  id: string;
  customer_id?: string | null;
  plan_id?: string | null;
  created_at?: number | null;
  start_at?: number | null;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  notes?: Record<string, string> | unknown[] | null;
}

export interface RazorpaySubState {
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  /** Identity is written only by the first events of a subscription; later ones update its row. */
  email: string | null;
  plan: string | null;
  customerId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const at = (s?: number | null) => (s ? new Date(s * 1000) : null);

export function razorpaySubscriptionState(
  eventType: string,
  sub: RazorpaySubEntity,
  nowSec: number = Date.now() / 1000,
): RazorpaySubState | null {
  const notes = sub.notes && !Array.isArray(sub.notes) ? sub.notes as Record<string, string> : {};
  const hasTrial = !!(sub.start_at && sub.created_at && sub.start_at > sub.created_at);
  const trialStart = hasTrial ? at(sub.created_at) : null;
  const trialEnd = hasTrial ? at(sub.start_at) : null;
  const inTrial = hasTrial && (sub.start_at as number) > nowSec;
  const identity = {
    email: notes.paycraft_email || notes.email || null,
    plan: notes.paycraft_plan || sub.plan_id || "unknown",
    customerId: sub.customer_id ?? null,
  };
  const noIdentity = { email: null, plan: null, customerId: null };
  const base = { trialStart: null, trialEnd: null, cancelAtPeriodEnd: false };

  switch (eventType) {
    case "subscription.authenticated":
      // Without a trial `activated` follows at once and carries the state; with one, this IS the start.
      if (!inTrial) return null;
      return { status: "trialing", ...identity, periodStart: trialStart, periodEnd: trialEnd, trialStart, trialEnd, cancelAtPeriodEnd: false };
    case "subscription.activated":
      return {
        status: inTrial ? "trialing" : "active", ...identity,
        periodStart: at(sub.current_start), periodEnd: at(sub.current_end) ?? trialEnd,
        trialStart, trialEnd, cancelAtPeriodEnd: false,
      };
    case "subscription.charged":
    case "subscription.resumed":
      return { status: "active", ...noIdentity, ...base, periodStart: at(sub.current_start), periodEnd: at(sub.current_end) };
    case "subscription.pending":
    case "subscription.halted":
      return { status: "past_due", ...noIdentity, ...base, periodStart: null, periodEnd: null };
    case "subscription.paused":
      return { status: "paused", ...noIdentity, ...base, periodStart: null, periodEnd: null };
    case "subscription.cancelled":
    case "subscription.completed":
      return { status: "canceled", ...noIdentity, ...base, periodStart: null, periodEnd: at(sub.ended_at), cancelAtPeriodEnd: true };
    default:
      return null;
  }
}
