export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { buildReviewScreenshotInput } from "@/lib/paywall-review-input"
import { renderPaywallReviewScreenshot } from "@/lib/paywall-review-screenshot"

/**
 * GET /api/paywall/review-screenshot → PNG
 *
 * The App Store review screenshot for this tenant's subscriptions, rendered from the live paywall
 * config and catalogue. Exists so an operator can SEE what product sync will upload before it does,
 * and so the same image can be downloaded if they would rather attach it by hand.
 *
 * Deliberately not cached: the paywall is server-driven, so an image that outlives an edit is the
 * exact staleness this feature removes.
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const input = await buildReviewScreenshotInput(supabase, tenant.id)
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 409 })
  }

  const png = await renderPaywallReviewScreenshot(input)
  // `.buffer` — a Uint8Array view is not a BodyInit in this TS lib target, while its ArrayBuffer is.
  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="paywall-review.png"`,
    },
  })
}
