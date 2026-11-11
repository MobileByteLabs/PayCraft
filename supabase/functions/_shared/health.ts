/**
 * Health checks behind `functions/v1/health` — what an uptime monitor polls.
 *
 * Why the provider is asked, not our own logs: a webhook rejected at signature or tenant resolution
 * returns before anything is written to webhook_logs, so for months live Stripe deliveries failed while
 * every internal signal stayed quiet. Stripe's own `delivery_success=false` list is the ground truth: an
 * event in it is one Stripe is still retrying (it keeps trying for 3 days), and it drops out of the list
 * the moment a retry lands — so the check clears itself once the fault is fixed.
 */

export interface Check {
  ok: boolean;
  detail: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Events this Stripe account still cannot deliver to any of its endpoints. */
export async function stripeUndelivered(secretKey: string, fetchFn: FetchLike = fetch): Promise<number> {
  const res = await fetchFn("https://api.stripe.com/v1/events?limit=100&delivery_success=false", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Stripe events API ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.data) ? body.data.length : 0;
}

/** One check per distinct key — several apps share a Stripe account, and one account is one answer. */
export async function stripeCheck(secretKeys: string[], fetchFn: FetchLike = fetch): Promise<Check> {
  const keys = [...new Set(secretKeys.filter(Boolean))];
  if (keys.length === 0) return { ok: true, detail: "no Stripe accounts configured" };
  let undelivered = 0;
  for (const key of keys) {
    try {
      undelivered += await stripeUndelivered(key, fetchFn);
    } catch (e) {
      return { ok: false, detail: `could not ask Stripe: ${(e as Error).message}` };
    }
  }
  return undelivered === 0
    ? { ok: true, detail: `${keys.length} account(s), all events delivered` }
    : { ok: false, detail: `${undelivered} event(s) Stripe cannot deliver` };
}

/** 200 only when every check is ok; the body never carries a secret, a tenant or a buyer. */
export function healthResponse(checks: Record<string, Check>, now = new Date()): Response {
  const ok = Object.values(checks).every((c) => c.ok);
  return new Response(
    JSON.stringify({ status: ok ? "ok" : "degraded", checks, checked_at: now.toISOString() }),
    { status: ok ? 200 : 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

/** Migration 185, behind an interface so the transition rules are testable without a database. */
export interface IncidentStore {
  /** true only for the call that OPENED the incident. */
  open(check: string, detail: string): Promise<boolean>;
  /** opened_at of the incident this call closed, or null when none was open. */
  resolve(check: string): Promise<Date | null>;
}

export type Notify = (subject: string, text: string) => Promise<void>;

/**
 * Emails on CHANGE only: failing → one alert when the incident opens; passing again → one recovery
 * note with the duration. Polling every few minutes therefore never floods an inbox, and any number
 * of pollers can run at once — the database decides which single call opened the incident.
 */
export async function recordTransitions(checks: Record<string, Check>, store: IncidentStore, notify: Notify): Promise<void> {
  for (const [name, c] of Object.entries(checks)) {
    try {
      if (!c.ok) {
        if (await store.open(name, c.detail)) {
          await notify(`PayCraft FAILING: ${name}`, `${name} is failing: ${c.detail}\n\nCurrent state and history: https://paycraft.mobilebytesensei.com/admin/health`);
        }
      } else {
        const openedAt = await store.resolve(name);
        if (openedAt) {
          const mins = Math.max(1, Math.round((Date.now() - openedAt.getTime()) / 60000));
          await notify(`PayCraft RESOLVED: ${name}`, `${name} is healthy again after ${mins} min.`);
        }
      }
    } catch (e) {
      // Alerting must never change the health answer itself.
      console.error(`[health] incident/alert for ${name} failed: ${(e as Error).message}`);
    }
  }
}
