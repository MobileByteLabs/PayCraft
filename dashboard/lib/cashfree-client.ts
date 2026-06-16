/**
 * Cashfree PG API client.
 *
 * Cashfree's REST API is documented at https://docs.cashfree.com/reference.
 * Auth: every request carries `x-client-id` and `x-client-secret` headers
 * which the merchant configured at /providers/cashfree. The API version
 * header is required; we pin to 2023-08-01 (current stable).
 *
 * Test vs live: Cashfree's sandbox lives at sandbox.cashfree.com; live at
 * api.cashfree.com. Mode is derived from the keys — test app_ids start with
 * "TEST" prefix in Cashfree's console; the secret carries no prefix
 * distinction. We treat any tenant_providers row with only test_key_id
 * populated as test-mode for the client.
 *
 * This wrapper only covers what the product-sync helper needs today:
 *   - POST /pg/links — create a Payment Link for a one-time charge
 *
 * Subscriptions (UPI Autopay) need a separate /pg/subscriptions path and a
 * mandate setup flow — out of scope for this phase; coming with the
 * Razorpay UPI Autopay work.
 */

const API_VERSION = "2023-08-01"

interface CashfreeClientConfig {
  appId: string
  secret: string
  mode: "test" | "live"
}

interface PaymentLinkRequest {
  link_id: string                  // operator-supplied unique id
  link_amount: number              // amount in INR (rupees, decimal)
  link_currency: "INR"             // Cashfree PG-Links only supports INR
  link_purpose: string             // shown in customer's checkout
  customer_details: {
    customer_phone?: string
    customer_email?: string
    customer_name?: string
  }
  link_meta?: {
    return_url?: string
    notify_url?: string             // webhook target
  }
  link_notes?: Record<string, string>
}

export interface PaymentLinkResponse {
  link_id: string
  link_url: string                  // Cashfree-hosted checkout URL
  link_status: "ACTIVE" | "PARTIALLY_PAID" | "PAID" | "EXPIRED" | "CANCELLED"
}

/**
 * Create a Payment Link. Returns the hosted checkout URL the SDK opens
 * for the customer.
 */
export async function cashfreeCreatePaymentLink(
  config: CashfreeClientConfig,
  payload: PaymentLinkRequest,
): Promise<PaymentLinkResponse> {
  const baseUrl =
    config.mode === "live"
      ? "https://api.cashfree.com/pg/links"
      : "https://sandbox.cashfree.com/pg/links"

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "x-client-id": config.appId,
      "x-client-secret": config.secret,
      "x-api-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(
      `Cashfree create-link failed (${res.status}): ${errorBody?.message ?? res.statusText}`,
    )
  }
  return (await res.json()) as PaymentLinkResponse
}

/**
 * Retrieve an existing Payment Link by link_id. Used by the reconciliation
 * pass to adopt links Cashfree already has under our metadata.
 */
export async function cashfreeGetPaymentLink(
  config: CashfreeClientConfig,
  linkId: string,
): Promise<PaymentLinkResponse | null> {
  const baseUrl =
    config.mode === "live"
      ? `https://api.cashfree.com/pg/links/${linkId}`
      : `https://sandbox.cashfree.com/pg/links/${linkId}`

  const res = await fetch(baseUrl, {
    method: "GET",
    headers: {
      "x-client-id": config.appId,
      "x-client-secret": config.secret,
      "x-api-version": API_VERSION,
    },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(
      `Cashfree get-link failed (${res.status}): ${errorBody?.message ?? res.statusText}`,
    )
  }
  return (await res.json()) as PaymentLinkResponse
}
