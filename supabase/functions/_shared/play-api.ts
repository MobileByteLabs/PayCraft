// Google Play Developer API reads shared by google-rtdn (push) and store-sync (daily pull).

// deno-lint-ignore no-explicit-any
type Any = any;

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** purchases.subscriptionsv2.get — Google's current truth for a subscription token. */
export async function subscriptionsv2Get(pkg: string, token: string, jwt: string): Promise<Record<string, Any>> {
  const res = await fetch(`${BASE}/${pkg}/purchases/subscriptionsv2/tokens/${token}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`subscriptionsv2.get failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

/**
 * purchases.voidedpurchases.list — tokens refunded, charged back or revoked since `startMs`
 * (Google keeps 30 days). `type=1` includes subscriptions; the default (0) lists one-time products only.
 * Needs the service account's "View financial data" permission in Play Console.
 */
export async function voidedPurchaseTokens(pkg: string, jwt: string, startMs: number): Promise<string[]> {
  const out: string[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ startTime: String(startMs), type: "1", maxResults: "1000" });
    if (page) q.set("token", page);
    const res = await fetch(`${BASE}/${pkg}/purchases/voidedpurchases?${q}`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`voidedpurchases.list failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    for (const v of body?.voidedPurchases ?? []) if (v?.purchaseToken) out.push(v.purchaseToken);
    page = body?.tokenPagination?.nextPageToken;
  } while (page);
  return out;
}
