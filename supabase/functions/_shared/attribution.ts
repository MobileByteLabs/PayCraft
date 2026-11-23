// supabase/functions/_shared/attribution.ts
//
// Attribution forwarding (migration 208): verified purchase lifecycle events → the app's GA4 (Firebase,
// Measurement Protocol) and AppsFlyer (S2S in-app events API), so ad campaigns can optimise for buyers and
// renewals — which the SDK never sees — are counted.
//
// Hooked in reconcileEntitlement(), the one path every Google Play / App Store / web-PSP event takes:
//   detectTransition(prev row, incoming event)  pure — trial_start | purchase | renewal | refund
//   ga4Payload / appsFlyerPayload               pure — the platforms' documented bodies
//   forwardLifecycle(db, …)                     best-effort sender; NEVER throws into the webhook path
// At-most-once per (integration, provider, stable_txn_id, event_kind, period_key) — the log's UNIQUE key.
// No PII leaves: users are identified only by the ids the SDK posted (app_instance_id / appsflyer_id).

import type { CanonicalState } from "./entitlement-reconcile.ts";

export type LifecycleKind = "trial_start" | "purchase" | "renewal" | "refund";
export interface Transition { kind: LifecycleKind; periodKey: string }

export interface PrevRow { canonical_state: CanonicalState; expires_at: string | null }
export interface NextState { canonicalState: CanonicalState; expiresAt: string | null }

/** States where the buyer has paid for the current period. */
const PAID: ReadonlySet<CanonicalState> = new Set(["active", "active_non_renewing", "in_grace_period"]);
/** States a renewal can follow (billing retry recovers into a new period). */
const RENEWABLE: ReadonlySet<CanonicalState> = new Set([...PAID, "on_billing_retry"]);
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/**
 * The lifecycle event a stored row → incoming state change represents, or null.
 *   new / pending → trial                     trial_start
 *   new / pending / trial → paid              purchase (a trial converting is the first purchase)
 *   lapsed (expired/cancelled/refunded/paused) → paid   purchase again, keyed by its period
 *   paid → paid with expires_at moved forward renewal, keyed by the new expiry
 *   anything else → refunded                  refund
 */
export function detectTransition(prev: PrevRow | null, next: NextState): Transition | null {
  const from = prev?.canonical_state ?? null;
  const to = next.canonicalState;
  if (to === "refunded") return from === "refunded" ? null : { kind: "refund", periodKey: "" };
  if (from === null || from === "pending") {
    if (to === "trial") return { kind: "trial_start", periodKey: "" };
    return PAID.has(to) ? { kind: "purchase", periodKey: "" } : null;
  }
  if (!PAID.has(to)) return null;
  if (from === "trial") return { kind: "purchase", periodKey: "" };
  if (RENEWABLE.has(from)) {
    return ms(next.expiresAt) > ms(prev!.expires_at) ? { kind: "renewal", periodKey: next.expiresAt! } : null;
  }
  // expired / cancelled / refunded / paused → paid: a resubscribe on the same transaction.
  return { kind: "purchase", periodKey: next.expiresAt ?? "" };
}

export interface Money { value: number; currency: string }

const GA4_NAMES: Record<LifecycleKind, string> = {
  trial_start: "start_trial",
  purchase: "purchase",
  renewal: "subscription_renew", // `app_store_subscription_renew` is reserved by GA4
  refund: "refund",
};

/** GA4 Measurement Protocol body for a Firebase app (sent with ?firebase_app_id=&api_secret=). */
export function ga4Payload(
  kind: LifecycleKind,
  appInstanceId: string,
  a: { transactionId: string; productId: string; money: Money | null },
): Record<string, unknown> {
  const params: Record<string, unknown> = { transaction_id: a.transactionId, item_id: a.productId.slice(0, 100) };
  if (a.money) Object.assign(params, { value: a.money.value, currency: a.money.currency });
  if (kind === "purchase" || kind === "renewal" || kind === "refund") {
    params.items = [{ item_id: a.productId.slice(0, 100), quantity: 1, ...(a.money ? { price: a.money.value } : {}) }];
  }
  return { app_instance_id: appInstanceId, events: [{ name: GA4_NAMES[kind], params }] };
}

const AF_NAMES: Record<LifecycleKind, string> = {
  trial_start: "af_start_trial",
  purchase: "af_subscribe",
  renewal: "af_renewal",
  refund: "af_refund",
};

/** "yyyy-MM-dd HH:mm:ss.SSS" UTC — AppsFlyer's eventTime format. */
export function afEventTime(at: Date): string {
  return at.toISOString().replace("T", " ").replace("Z", "");
}

/** AppsFlyer S2S in-app event body (POST /inappevent/{app_id}, header `authentication: <dev key>`). */
export function appsFlyerPayload(
  kind: LifecycleKind,
  appsflyerId: string,
  a: { transactionId: string; productId: string; money: Money | null; at: Date },
): Record<string, unknown> {
  const eventValue: Record<string, unknown> = { af_order_id: a.transactionId, af_content_id: a.productId };
  const body: Record<string, unknown> = {
    appsflyer_id: appsflyerId,
    eventName: AF_NAMES[kind],
    eventValue,
    eventTime: afEventTime(a.at),
    af_events_api: "true",
  };
  if (a.money) {
    // A refund is negative revenue so AppsFlyer nets it out of the campaign's total.
    eventValue.af_revenue = String(kind === "refund" ? -a.money.value : a.money.value);
    body.eventCurrency = a.money.currency;
  }
  return body;
}

/** Catalogue price for a product, or null — an unknown price sends no value rather than a wrong one. */
export function moneyFrom(row: { base_price_cents: number | null; base_currency: string | null } | null): Money | null {
  if (!row || !row.base_price_cents || row.base_price_cents <= 0 || !row.base_currency) return null;
  return { value: row.base_price_cents / 100, currency: row.base_currency.toUpperCase() };
}

/** GA4 caps a param at 100 chars and a Play purchase token is longer: a stable 32-hex digest. */
export async function forwardTxnId(provider: string, stableTxnId: string, kind: LifecycleKind, periodKey: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${provider}|${stableTxnId}|${kind}|${periodKey}`));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ── Sender ────────────────────────────────────────────────────────────────────────────────────────

export interface LifecycleEvent {
  tenantId: string | null;
  provider: string;
  productId: string;
  stableTxnId: string;
  appUserId: string;
  isSandbox: boolean;
}

type Integration = { platform: "ga4" | "appsflyer"; config: Record<string, string>; secret: string };
const MAX_ATTEMPTS = 5;

/**
 * Forward [transition] (plus any earlier event of this transaction still owed — no ids yet, or a failed
 * send) to every integration the tenant configured. Best-effort: every failure is logged and recorded,
 * nothing is thrown, so a webhook is never failed or retried because an ad platform was down.
 */
// deno-lint-ignore no-explicit-any
export async function forwardLifecycle(db: any, ev: LifecycleEvent, transition: Transition | null): Promise<void> {
  try {
    if (!ev.tenantId || ev.isSandbox) return; // test purchases never reach an ad campaign
    const { data: integrations, error } = await db.rpc("tenant_attribution_decrypt", { p_tenant_id: ev.tenantId });
    if (error || !integrations?.length) return;

    const { data: owed } = await db.from("attribution_forwards")
      .select("integration,event_kind,period_key")
      .eq("provider", ev.provider).eq("stable_txn_id", ev.stableTxnId)
      .in("status", ["failed", "no_ids"]).lt("attempts", MAX_ATTEMPTS);

    const { data: ids } = await db.rpc("attribution_ids_for_user", { p_tenant_id: ev.tenantId, p_app_user_id: ev.appUserId })
      .maybeSingle();
    let money: Money | null | undefined;

    for (const integ of integrations as Integration[]) {
      const jobs: Transition[] = (owed ?? [])
        .filter((o: { integration: string }) => o.integration === integ.platform)
        .map((o: { event_kind: LifecycleKind; period_key: string }) => ({ kind: o.event_kind, periodKey: o.period_key }));
      if (transition && !jobs.some((j) => j.kind === transition.kind && j.periodKey === transition.periodKey)) jobs.push(transition);

      for (const job of jobs) {
        if (!(await claim(db, ev, integ.platform, job))) continue;
        const userId = integ.platform === "ga4" ? ids?.firebase_app_instance_id : ids?.appsflyer_id;
        if (!userId) {
          await record(db, ev, integ.platform, job, "no_ids", null, null);
          continue;
        }
        if (money === undefined) money = await priceFor(db, ev);
        const transactionId = await forwardTxnId(ev.provider, ev.stableTxnId, job.kind, job.periodKey);
        const res = await send(integ, job.kind, userId, { transactionId, productId: ev.productId, money });
        await record(db, ev, integ.platform, job, res.ok ? "sent" : "failed", res.status, res.error);
      }
    }
  } catch (e) {
    console.error(`attribution forward failed (non-fatal): ${(e as Error).message}`);
  }
}

/** Take the send: a fresh row, or a failed / no-ids one under the attempt cap. False = already handled. */
// deno-lint-ignore no-explicit-any
async function claim(db: any, ev: LifecycleEvent, integration: string, t: Transition): Promise<boolean> {
  const key = { integration, provider: ev.provider, stable_txn_id: ev.stableTxnId, event_kind: t.kind, period_key: t.periodKey };
  const { data: inserted } = await db.from("attribution_forwards")
    .upsert({ tenant_id: ev.tenantId, ...key }, { onConflict: "integration,provider,stable_txn_id,event_kind,period_key", ignoreDuplicates: true })
    .select("id");
  if (inserted?.length) return true;
  const { data: row } = await db.from("attribution_forwards").select("id,attempts,status").match(key).maybeSingle();
  if (!row || !["failed", "no_ids"].includes(row.status) || row.attempts >= MAX_ATTEMPTS) return false;
  // Compare-and-set on the attempt count: a concurrent retry that took it first wins.
  const { data: taken } = await db.from("attribution_forwards")
    .update({ status: "pending", attempts: row.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("attempts", row.attempts).select("id");
  return !!taken?.length;
}

// deno-lint-ignore no-explicit-any
async function record(db: any, ev: LifecycleEvent, integration: string, t: Transition, status: string, http: number | null, err: string | null) {
  await db.from("attribution_forwards")
    .update({ status, http_status: http, error: err?.slice(0, 300) ?? null, updated_at: new Date().toISOString() })
    .match({ integration, provider: ev.provider, stable_txn_id: ev.stableTxnId, event_kind: t.kind, period_key: t.periodKey });
}

// deno-lint-ignore no-explicit-any
async function priceFor(db: any, ev: LifecycleEvent): Promise<Money | null> {
  const id = ev.productId.replace(/[,()]/g, "");
  const { data } = await db.from("tenant_products").select("base_price_cents,base_currency")
    .eq("tenant_id", ev.tenantId)
    .or(`play_product_id.eq.${id},app_store_product_id.eq.${id},sku.eq.${id}`)
    .limit(1);
  return moneyFrom(data?.[0] ?? null);
}

async function send(
  integ: Integration,
  kind: LifecycleKind,
  userId: string,
  a: { transactionId: string; productId: string; money: Money | null },
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    let res: Response;
    if (integ.platform === "ga4") {
      const appId = integ.config.firebase_app_id;
      if (!appId) return { ok: false, status: null, error: "firebase_app_id missing" };
      const url = `https://www.google-analytics.com/mp/collect?firebase_app_id=${encodeURIComponent(appId)}&api_secret=${encodeURIComponent(integ.secret)}`;
      res = await fetch(url, { method: "POST", body: JSON.stringify(ga4Payload(kind, userId, a)), signal: AbortSignal.timeout(5000) });
    } else {
      const appId = integ.config.app_id;
      if (!appId) return { ok: false, status: null, error: "app_id missing" };
      res = await fetch(`https://api2.appsflyer.com/inappevent/${encodeURIComponent(appId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", authentication: integ.secret },
        body: JSON.stringify(appsFlyerPayload(kind, userId, { ...a, at: new Date() })),
        signal: AbortSignal.timeout(5000),
      });
    }
    // GA4's MP answers 2xx even for a malformed hit (validation only on /debug/mp/collect).
    return res.ok ? { ok: true, status: res.status, error: null } : { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
  } catch (e) {
    // Deno's network errors quote the request URL — which carries the GA4 api_secret.
    return { ok: false, status: null, error: (e as Error).message.replaceAll(integ.secret, "***") };
  }
}
