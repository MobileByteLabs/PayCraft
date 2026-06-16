import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * Record a UPI payment intent into the reconciliation ledger.
 *
 * Called every time the router/options endpoint returns a UPI Direct URL —
 * the intent is the durable receipt of "here's what we told a customer to
 * pay, here's the reference embedded in the deep link". Without it the
 * dashboard has no way to surface "you have a pending UPI payment from
 * customer X for ₹999".
 *
 * Best-effort: logs failures but never throws. A missing intent doesn't
 * block the customer's checkout — they can still pay; the merchant just
 * loses the auto-population of reference/amount on the reconciliation
 * page (they'd have to enter manually instead).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function recordUpiIntent(args: {
  tenantId: string
  productId: string
  reference: string
  vpa: string
  vpaDisplayName: string
  amountPaise: number
  customerEmail?: string | null
  customerName?: string | null
}): Promise<void> {
  if (!SERVICE_ROLE) {
    // Service role missing — local-dev oversight, skip without spamming logs.
    return
  }
  try {
    const admin = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await admin.rpc("upi_payment_intent_create", {
      p_tenant_id: args.tenantId,
      p_product_id: args.productId,
      p_reference: args.reference,
      p_vpa: args.vpa,
      p_vpa_display_name: args.vpaDisplayName,
      p_amount_paise: args.amountPaise,
      p_customer_email: args.customerEmail ?? null,
      p_customer_name: args.customerName ?? null,
    })
    if (error) {
      console.warn(
        `[upi-intent-recorder] failed to record intent ${args.reference}: ${error.message}`,
      )
    }
  } catch (e: any) {
    console.warn(
      `[upi-intent-recorder] unexpected error recording intent: ${e?.message ?? e}`,
    )
  }
}
