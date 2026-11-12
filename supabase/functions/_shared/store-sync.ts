/**
 * Daily store sync — pulls from Google Play and the App Store what their push notifications can miss.
 *
 *   Google Play  re-read every subscription token that is not finished (or changed recently) with
 *                purchases.subscriptionsv2.get, and mark the tokens purchases.voidedpurchases.list
 *                reports (refund, chargeback, revoke) as `refunded`.
 *   App Store    replay the Notification History (every notification Apple sent, up to 180 days)
 *                through the same handler the live webhook uses.
 *
 * Neither store reports a purchase that failed or was cancelled on the payment sheet — no purchase
 * exists, so there is nothing to notify or list. Those reach PayCraft only from the SDK.
 */
import { type CanonicalEvent, googleToCanonical } from "./entitlement-reconcile.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface PlaySyncDeps {
  /** Purchase tokens Google voided in the window (refund / chargeback / revoke). */
  voidedTokens(): Promise<string[]>;
  /** This app's Play subscription tokens worth re-reading — always including any voided one. */
  knownTokens(voided: string[]): Promise<Array<{ token: string; appUserId: string }>>;
  /** purchases.subscriptionsv2.get */
  truth(token: string): Promise<Record<string, Any>>;
  reconcile(ev: CanonicalEvent): Promise<void>;
}

export async function syncPlayTenant(tenantId: string, d: PlaySyncDeps) {
  const voided = await d.voidedTokens();
  const voidedSet = new Set(voided);
  let rechecked = 0, refunded = 0, errors = 0;
  for (const k of await d.knownTokens(voided)) {
    try {
      const ev = googleToCanonical(await d.truth(k.token), k.token, k.appUserId);
      if (voidedSet.has(k.token)) {
        // subscriptionsv2 reports a refunded subscription merely as EXPIRED — the voided list is the
        // only place Google says it was a refund, and support needs to tell the two apart.
        ev.canonicalState = "refunded";
        ev.willRenew = false;
        ev.inGraceUntil = null;
        refunded++;
      }
      await d.reconcile({ ...ev, tenantId });
      rechecked++;
    } catch (e) {
      errors++;
      console.error(`[store-sync] play token ${k.token.slice(0, 12)}… failed: ${(e as Error).message}`);
    }
  }
  return { rechecked, refunded, errors };
}

/** App Store Server API — Get Notification History, every page. Returns the signed payloads. */
export async function appleHistory(
  host: string,
  jwt: string,
  startMs: number,
  endMs: number,
  fetchFn: (u: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await fetchFn(`${host}/inApps/v1/notifications/history${token ? `?paginationToken=${encodeURIComponent(token)}` : ""}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: startMs, endDate: endMs }),
    });
    if (!res.ok) throw new Error(`notification history ${res.status}: ${await res.text()}`);
    const body = await res.json();
    for (const n of body?.notificationHistory ?? []) if (n?.signedPayload) out.push(n.signedPayload);
    token = body?.hasMore ? body.paginationToken : undefined;
  } while (token);
  return out;
}
