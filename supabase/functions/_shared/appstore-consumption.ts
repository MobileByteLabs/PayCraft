// App Store refund requests (migration 207). Apple sends CONSUMPTION_REQUEST when a customer asks for a refund and
// waits up to 12 hours for consumption information — Send Consumption Information, App Store Server API:
// PUT /inApps/v1/transactions/consumption/{transactionId}. Only facts PayCraft actually knows are declared; the rest
// are sent as 0 ("undeclared"), never guessed — a wrong answer to Apple is worse than none.

import { supabaseAdmin } from "./supabase-admin.ts";

const DAY = 86_400_000;

/** Apple's accountTenure buckets (days since the customer's first purchase). 0 = undeclared. */
export function tenureBucket(firstPurchaseMs: number | undefined, nowMs: number): number {
  if (!firstPurchaseMs || firstPurchaseMs > nowMs) return 0;
  const days = (nowMs - firstPurchaseMs) / DAY;
  const upper = [3, 10, 30, 90, 180, 365];
  const i = upper.findIndex((d) => days < d);
  return i === -1 ? 7 : i + 1;
}

/**
 * Apple's consumptionStatus for what was bought. A subscription is consumed as its period passes: not yet started
 * → 1 not consumed, period over → 3 fully consumed, in between → 2 partially. A one-time purchase PayCraft cannot
 * see being used → 0 undeclared.
 */
export function consumptionStatus(tx: { type?: string; purchaseDate?: number; expiresDate?: number }, nowMs: number): number {
  if (tx.type !== "Auto-Renewable Subscription" || !tx.purchaseDate || !tx.expiresDate) return 0;
  if (nowMs <= tx.purchaseDate) return 1;
  if (nowMs >= tx.expiresDate) return 3;
  return 2;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ConsumptionRequest body. `tx` is the decoded signedTransactionInfo of the notification. */
export function buildConsumptionRequest(
  tx: Record<string, any>,
  refundPreference: number,
  nowMs: number,
): Record<string, unknown> {
  return {
    customerConsented: true,
    consumptionStatus: consumptionStatus(tx, nowMs),
    platform: 1, // Apple platform — the purchase came through StoreKit
    sampleContentProvided: false,
    deliveryStatus: 0, // delivered and working: the entitlement was granted from this transaction
    appAccountToken: typeof tx.appAccountToken === "string" && UUID.test(tx.appAccountToken) ? tx.appAccountToken : "",
    accountTenure: tenureBucket(tx.originalPurchaseDate ?? tx.purchaseDate, nowMs),
    playTime: 0,
    lifetimeDollarsRefunded: 0,
    lifetimeDollarsPurchased: 0,
    userStatus: 0,
    refundPreference: [0, 1, 2, 3].includes(refundPreference) ? refundPreference : 0,
  };
}

/**
 * Answer one CONSUMPTION_REQUEST. Logs every request; sends only with the tenant's consent switch on. Never throws
 * for a "not sent" outcome — the notification is still acknowledged so Apple stops re-sending it — but a failed
 * PUT throws, so Apple re-delivers and the answer is retried inside its 12-hour window.
 */
export async function answerConsumptionRequest(args: {
  tenantId: string | null;
  tx: Record<string, any>;
  sandbox: boolean;
  jwt: () => Promise<string>;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<string> {
  const { tenantId, tx, sandbox } = args;
  const transactionId: string | undefined = tx.transactionId;
  if (!transactionId) throw new Error("CONSUMPTION_REQUEST without transactionId");

  const { data: done } = await supabaseAdmin.from("appstore_consumption_responses")
    .select("outcome").eq("transaction_id", transactionId).maybeSingle();
  if (done?.outcome === "sent") return "sent";

  const { data: tenant } = tenantId
    ? await supabaseAdmin.from("tenants")
      .select("appstore_consumption_consent, appstore_refund_preference").eq("id", tenantId).maybeSingle()
    : { data: null };

  const log = (outcome: string, apple_status: number | null, request: unknown) =>
    supabaseAdmin.from("appstore_consumption_responses").upsert({
      tenant_id: tenantId, transaction_id: transactionId, product_id: tx.productId ?? null,
      outcome, apple_status, request, updated_at: new Date().toISOString(),
    }, { onConflict: "transaction_id" });

  if (!tenant?.appstore_consumption_consent) {
    await log("no_consent", null, null);
    return "no_consent";
  }
  let token: string;
  try {
    token = await args.jwt();
  } catch {
    await log("no_credentials", null, null);
    return "no_credentials";
  }

  const body = buildConsumptionRequest(tx, tenant.appstore_refund_preference ?? 0, args.nowMs ?? Date.now());
  const host = sandbox ? "https://api.storekit-sandbox.itunes.apple.com" : "https://api.storekit.itunes.apple.com";
  const res = await (args.fetchImpl ?? fetch)(`${host}/inApps/v1/transactions/consumption/${transactionId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await res.body?.cancel();
  await log(res.ok ? "sent" : "failed", res.status, body);
  if (!res.ok) throw new Error(`Send Consumption Information failed (${res.status})`);
  return "sent";
}
