import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * /pay/razorpay/{subscription_id} — brings a Razorpay subscription buyer BACK to the site.
 *
 * Razorpay's hosted subscription page (short_url) cannot redirect: a ReelExport buyer who paid stayed on
 * razorpay.com (2026-11-13). Stripe returns buyers through success_url. checkout-initiate now stores the
 * validated return URLs in `razorpay_checkout_returns` (migration 192) and sends the buyer here; this page
 * opens Razorpay Checkout over the subscription and redirects to the STORED success / cancel URL — the same
 * `paycraft_checkout=success|cancel` URLs Stripe uses, so a site handles both providers' returns alike.
 * Nothing in the link decides where the buyer goes.
 */
export interface RazorpayReturnRow {
  subscription_id: string
  tenant_id: string
  mode: "live" | "test"
  key_id: string
  success_url: string
  cancel_url: string
  short_url: string
  email: string | null
  product_name: string | null
}

const SUB_ID = /^sub_[A-Za-z0-9]{6,40}$/

export function isSubscriptionId(id: string): boolean {
  return SUB_ID.test(id)
}

const httpUrl = (u: string, fallback: string) => (/^https?:\/\//.test(u) ? u : fallback)

/** What the page hands Razorpay Checkout, plus where to send the buyer after. */
export function checkoutOptionsFor(row: RazorpayReturnRow) {
  return {
    key: row.key_id,
    subscription_id: row.subscription_id,
    description: row.product_name ?? "",
    prefill: row.email ? { email: row.email } : {},
    // Belt and braces: the table already refuses non-http urls (192). Fall back to Razorpay's own page.
    successUrl: httpUrl(row.success_url, row.short_url),
    cancelUrl: httpUrl(row.cancel_url, row.short_url),
    shortUrl: row.short_url,
  }
}

/** Server-only: the stored return for [id], or null (unknown, malformed, or older than 7 days). */
export async function loadRazorpayReturn(id: string): Promise<RazorpayReturnRow | null> {
  if (!isSubscriptionId(id)) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const db = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data } = await db
    .from("razorpay_checkout_returns")
    .select("subscription_id, tenant_id, mode, key_id, success_url, cancel_url, short_url, email, product_name")
    .eq("subscription_id", id)
    .gte("created_at", since)
    .maybeSingle()
  return (data as RazorpayReturnRow | null) ?? null
}
