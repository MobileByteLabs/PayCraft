"use client"

import { useEffect, useState } from "react"
import type { checkoutOptionsFor } from "@/lib/razorpay-pay"

type Options = ReturnType<typeof checkoutOptionsFor>

declare global {
  interface Window {
    // deno-lint-ignore no-explicit-any
    Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(ev: string, fn: (e: any) => void): void }
  }
}

const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js"

/**
 * Opens Razorpay Checkout over the stored subscription and sends the buyer back to the site:
 * paid → success URL, closed → cancel URL (both stored server-side by checkout-initiate).
 * If Checkout cannot load (blocked script, no JS), the buyer can still pay on Razorpay's own page.
 */
export function RazorpayPay({ options }: { options: Options }) {
  const [state, setState] = useState<"loading" | "open" | "paid" | "failed">("loading")

  useEffect(() => {
    let cancelled = false
    const start = () => {
      if (cancelled || !window.Razorpay) return setState("failed")
      const rzp = new window.Razorpay({
        key: options.key,
        subscription_id: options.subscription_id,
        description: options.description,
        prefill: options.prefill,
        handler: () => {
          setState("paid")
          window.location.assign(options.successUrl)
        },
        modal: { ondismiss: () => window.location.assign(options.cancelUrl), escape: true },
      })
      rzp.open()
      setState("open")
    }
    if (window.Razorpay) start()
    else {
      const s = document.createElement("script")
      s.src = CHECKOUT_JS
      s.async = true
      s.onload = start
      s.onerror = () => !cancelled && setState("failed")
      document.body.appendChild(s)
    }
    return () => {
      cancelled = true
    }
  }, [options])

  return (
    <main style={{ maxWidth: 420, margin: "15vh auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <h1 style={{ fontSize: 22 }}>{state === "paid" ? "Payment received" : "Complete your subscription"}</h1>
      {options.description ? <p style={{ color: "#555" }}>{options.description}</p> : null}
      {state === "paid" ? <p>Taking you back…</p> : null}
      {state === "failed" ? (
        <p>
          The payment window couldn&apos;t open here.{" "}
          <a href={options.shortUrl}>Pay on Razorpay instead</a>, then return to the site.
        </p>
      ) : null}
      {state === "loading" ? <p style={{ color: "#555" }}>Opening secure payment…</p> : null}
      {state === "open" ? (
        <p style={{ color: "#555" }}>
          Closed the payment window? <a href={options.cancelUrl}>Go back</a>
        </p>
      ) : null}
    </main>
  )
}
