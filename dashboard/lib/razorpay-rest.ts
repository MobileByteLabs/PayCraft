import { hmacSha256Hex, timingSafeEqualStr } from "./edge-crypto"

/**
 * Edge-native Razorpay REST client.
 *
 * The official `razorpay` npm SDK pulls Node's `crypto`/`https` and does not
 * build on the Cloudflare edge runtime. Razorpay's API is a thin REST surface,
 * so we call it directly with Basic auth + fetch. Only the endpoints the
 * dashboard actually uses are implemented; the method shapes mirror the SDK
 * (`client.subscriptions.create`, `client.payments.all`, `client.offers.create`)
 * so call sites are unchanged.
 */

const BASE = "https://api.razorpay.com/v1"

export interface RazorpayRestClient {
  subscriptions: { create(payload: Record<string, unknown>): Promise<any> }
  payments: { all(params?: { count?: number }): Promise<any> }
  offers: { create(payload: Record<string, unknown>): Promise<any> }
  plans: {
    create(payload: Record<string, unknown>): Promise<any>
    /** Read a plan back. Used to VERIFY a stored id still exists before trusting it. */
    fetch(planId: string): Promise<any>
  }
  paymentLink: { create(payload: Record<string, unknown>): Promise<any> }
  subscriptionRegistration: {
    createRegistrationLink(payload: Record<string, unknown>): Promise<any>
  }
}

export function razorpayRest(keyId: string, keySecret: string): RazorpayRestClient {
  const auth = "Basic " + btoa(`${keyId}:${keySecret}`)

  async function call(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ): Promise<any> {
    const url = new URL(BASE + path)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: auth,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Mirror the SDK error shape callers read: `e.error.description` / `e.statusCode`.
      const err = new Error(json?.error?.description ?? `razorpay ${res.status}`) as Error & {
        statusCode?: number
        error?: unknown
      }
      err.statusCode = res.status
      err.error = json?.error
      throw err
    }
    return json
  }

  return {
    subscriptions: { create: (payload) => call("POST", "/subscriptions", payload) },
    payments: { all: (params) => call("GET", "/payments", undefined, { count: params?.count }) },
    offers: { create: (payload) => call("POST", "/offers", payload) },
    plans: {
      create: (payload) => call("POST", "/plans", payload),
      fetch: (planId) => call("GET", `/plans/${planId}`),
    },
    paymentLink: { create: (payload) => call("POST", "/payment_links", payload) },
    subscriptionRegistration: {
      createRegistrationLink: (payload) =>
        call("POST", "/subscription_registration/auth_links", payload),
    },
  }
}

/**
 * Verify a Razorpay webhook signature (HMAC-SHA256 hex of the raw body with the
 * webhook secret) — replaces `Razorpay.validateWebhookSignature`.
 */
export async function validateRazorpayWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, body)
  return timingSafeEqualStr(expected, signature)
}
