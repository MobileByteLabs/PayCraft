export const runtime = "edge"
export const dynamic = "force-dynamic"

import type { Metadata } from "next"
import { checkoutOptionsFor, loadRazorpayReturn } from "@/lib/razorpay-pay"
import { RazorpayPay } from "./razorpay-pay"

export const metadata: Metadata = {
  title: "Complete your subscription",
  robots: { index: false, follow: false },
}

/**
 * Public on purpose (outside the signed-in dashboard group): the BUYER lands here from a site's checkout.
 * See lib/razorpay-pay.ts for why it exists. Unknown or expired ids get a dead end, never a redirect.
 */
export default async function RazorpayPayPage({ params }: { params: { id: string } }) {
  const row = await loadRazorpayReturn(params.id)
  if (!row) {
    return (
      <main style={{ maxWidth: 420, margin: "15vh auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>This checkout link has expired</h1>
        <p style={{ color: "#555" }}>Go back to the site you were buying from and start the checkout again.</p>
      </main>
    )
  }
  return <RazorpayPay options={checkoutOptionsFor(row)} />
}
