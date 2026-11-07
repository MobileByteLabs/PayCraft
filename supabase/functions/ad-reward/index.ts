/**
 * ad-reward — AdMob server-side-verification callback. The ONLY thing that may credit `ad_reward`.
 *
 * ## Why a callback and not a client call
 *
 * A client that could say "I watched an ad" mints currency with no attention sold — the same shape
 * as the caller-supplied subject id migration 159 closed, and the caller-supplied email 162 closed.
 * So `entitlement_balance_ad_reward` is granted to `service_role` only and has no client-callable
 * overload, and this function is its sole caller.
 *
 * AdMob signs each callback with ECDSA (secp256r1) over the query string and publishes the public
 * keys. Verifying that signature is what separates "a user watched an ad" from "someone sent us an
 * HTTP request".
 *
 * ## The signature covers a SUBSTRING, not the parsed params
 *
 * Google signs the raw query string up to (but excluding) `&signature=`. Re-serialising parsed
 * params would reorder or re-encode them and the signature would never verify — so the raw string
 * is sliced, never rebuilt. This is the single easiest thing to get wrong here.
 *
 * GET /ad-reward?...&custom_data=<device_token>|<sku>&signature=...&key_id=...
 * 200 OK on success AND on replay (AdMob retries; a retry is normal traffic, not a fault).
 */

import { supabaseAdmin } from "../_shared/supabase-admin.ts";

const VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

interface VerifierKey {
  keyId: number;
  pem: string;
  base64: string;
}

/**
 * Key set cached for the isolate's lifetime. Google rotates these rarely; refetching per callback
 * would add a third-party round-trip to every ad reward and make our credit path depend on
 * gstatic's latency.
 */
let keyCache: { fetchedAt: number; keys: Map<number, CryptoKey> } | null = null;
const KEY_TTL_MS = 6 * 60 * 60 * 1000;

async function verifierKeys(): Promise<Map<number, CryptoKey>> {
  if (keyCache && Date.now() - keyCache.fetchedAt < KEY_TTL_MS) return keyCache.keys;

  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`verifier keys unavailable (${res.status})`);
  const body = (await res.json()) as { keys: VerifierKey[] };

  const keys = new Map<number, CryptoKey>();
  for (const k of body.keys ?? []) {
    // `base64` is the raw X9.62 uncompressed EC point Google publishes; import it as a raw P-256
    // public key for ECDSA verification.
    const raw = Uint8Array.from(atob(k.base64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    keys.set(Number(k.keyId), key);
  }
  keyCache = { fetchedAt: Date.now(), keys };
  return keys;
}

/**
 * DER (SEQUENCE of two INTEGERs) → raw r||s, which is what WebCrypto's ECDSA verify expects.
 *
 * Returns `Uint8Array<ArrayBuffer>` explicitly: a plain `Uint8Array` is `ArrayBufferLike`, which
 * could be backed by a `SharedArrayBuffer`, and `crypto.subtle.verify` will not accept that.
 */
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2; // skip SEQUENCE tag + length
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = (): Uint8Array<ArrayBuffer> => {
    if (der[i] !== 0x02) throw new Error("malformed DER signature");
    const len = der[i + 1];
    let start = i + 2;
    let end = start + len;
    // Strip the leading zero DER adds to keep an integer positive.
    while (der[start] === 0x00 && end - start > 32) start++;
    i = end;
    const out = new Uint8Array(new ArrayBuffer(32));
    out.set(der.subarray(start, end), 32 - (end - start));
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(new ArrayBuffer(64));
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;

  const signatureB64 = q.get("signature");
  const keyId = q.get("key_id");
  const customData = q.get("custom_data") ?? "";
  const transactionId = q.get("transaction_id") ?? "";
  const rewardAmount = Number(q.get("reward_amount") ?? "0");

  if (!signatureB64 || !keyId) return json({ error: "missing signature or key_id" }, 400);
  if (!transactionId) return json({ error: "missing transaction_id" }, 400);

  // ── the signed substring ────────────────────────────────────────────────────────────────────
  const raw = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const sigIndex = raw.indexOf("&signature=");
  if (sigIndex < 0) return json({ error: "signature must not be the first parameter" }, 400);
  const signedPayload = raw.slice(0, sigIndex);

  // ── verify ──────────────────────────────────────────────────────────────────────────────────
  try {
    const keys = await verifierKeys();
    const key = keys.get(Number(keyId));
    if (!key) return json({ error: `unknown key_id ${keyId}` }, 401);

    const sigDer = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(sigDer),
      new TextEncoder().encode(signedPayload),
    );
    if (!ok) return json({ error: "invalid signature" }, 401);
  } catch (e) {
    return json({ error: `verification failed: ${(e as Error).message}` }, 401);
  }

  // ── who and what ────────────────────────────────────────────────────────────────────────────
  // custom_data is "<device_token>|<sku>", set by the SDK when it requested the ad. A device token
  // rather than a subject id, so a caller can only ever name itself.
  const [deviceToken, sku] = customData.split("|");
  if (!deviceToken || !sku) {
    // The ad was watched but we cannot attribute it. Loud: the user spent attention for nothing,
    // and the cause is a client that did not set customData.
    return json({ error: "custom_data must be '<device_token>|<sku>'" }, 400);
  }

  const { data: device, error: deviceError } = await supabaseAdmin
    .from("registered_devices")
    .select("subject_id, tenant_id")
    .eq("device_token", deviceToken)
    .eq("is_active", true)
    .maybeSingle();

  if (deviceError) return json({ error: `device lookup failed: ${deviceError.message}` }, 500);
  if (!device?.subject_id) return json({ error: "unknown or inactive device token" }, 404);

  // ── how much ────────────────────────────────────────────────────────────────────────────────
  // The CATALOGUE decides, not the callback. `reward_amount` is configured in the AdMob console and
  // is outside our control; taking it verbatim would let an ad-unit misconfiguration (or anyone who
  // can forge a unit) set the price of our currency. Fall back to it only when the tenant has not
  // declared a per-ad reward.
  const { data: product } = await supabaseAdmin
    .from("tenant_products")
    .select("ad_reward_quantity, grant_sku, sku")
    .eq("tenant_id", device.tenant_id)
    .eq("sku", sku)
    .maybeSingle();

  const quantity = Number(product?.ad_reward_quantity ?? 0) > 0
    ? Number(product!.ad_reward_quantity)
    : 0;

  if (quantity <= 0) {
    return json({
      error: "ad rewards not enabled for this sku",
      detail: "set tenant_products.ad_reward_quantity",
    }, 409);
  }

  const { error: creditError } = await supabaseAdmin.rpc("entitlement_balance_ad_reward", {
    p_tenant_id: device.tenant_id,
    p_subject_id: device.subject_id,
    // Credit the CURRENCY (migration 164), so an ad reward lands in the same balance a purchase
    // and a focus session do rather than in a per-product pocket of its own.
    p_sku: (product?.grant_sku ?? "").trim() || sku,
    p_quantity: quantity,
    // AdMob's transaction_id is stable per reward and is retried verbatim, so it is the natural
    // idempotency anchor. Prefixed, like every other provider, so two networks cannot collide.
    p_idempotency_key: `admob:${transactionId}`,
  });

  if (creditError) return json({ error: `credit failed: ${creditError.message}` }, 500);

  // 200 on replay too: AdMob retries until it gets one, and the RPC absorbed the duplicate.
  return json({ ok: true, sku, quantity, declared_reward_amount: rewardAmount });
});
