/**
 * Where a Razorpay subscription checkout sends the buyer, so they come BACK to the site afterwards.
 *
 * Razorpay's hosted subscription page (`short_url`) cannot redirect: a buyer who paid on it stayed on
 * razorpay.com (ReelExport, user-reported 2026-11-13). Stripe returns buyers through `success_url`
 * (stripe-session.ts#returnUrls). The Razorpay lane now mirrors that:
 *
 *   valid return_url → `{payBase}/pay/razorpay/{subscription_id}` — PayCraft's pay page opens Razorpay
 *                      Checkout over the subscription and redirects to the SAME tagged URLs Stripe uses
 *                      (`paycraft_checkout=success|cancel`), read from the row stored here.
 *   no / invalid     → the hosted `short_url`, exactly as before (KMP apps send no return_url).
 *
 * The return URL lives only in `razorpay_checkout_returns` (migration 192), never in the link — the pay
 * page cannot be turned into a redirect to someone else's site by editing a query string.
 */
import { returnUrls } from "./stripe-session.ts";

export interface RazorpayReturnRow {
  subscription_id: string;
  tenant_id: string;
  mode: "live" | "test";
  key_id: string;
  success_url: string;
  cancel_url: string;
  short_url: string;
  email: string | null;
  product_name: string | null;
}

const SUB_ID = /^sub_[A-Za-z0-9]{6,40}$/;

export function razorpayCheckoutTarget(i: {
  subscriptionId: string;
  shortUrl: string;
  tenantId: string;
  mode: "live" | "test";
  keyId: string;
  payBase: string;
  returnUrl: string | null;
  origin: string | null;
  email?: string | null;
  productName?: string | null;
}): { url: string; row: RazorpayReturnRow | null } {
  const hosted = { url: i.shortUrl, row: null };
  if (!SUB_ID.test(i.subscriptionId)) return hosted;
  const back = returnUrls(i.returnUrl, i.origin);
  if ("error" in back) return hosted;
  return {
    url: `${i.payBase.replace(/\/+$/, "")}/pay/razorpay/${i.subscriptionId}`,
    row: {
      subscription_id: i.subscriptionId,
      tenant_id: i.tenantId,
      mode: i.mode,
      key_id: i.keyId,
      success_url: back.success,
      cancel_url: back.cancel,
      short_url: i.shortUrl,
      email: i.email ?? null,
      product_name: i.productName ?? null,
    },
  };
}
