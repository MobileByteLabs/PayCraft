import type { createClient } from "@/lib/supabase-server"
import type { ReviewScreenshotInput, ReviewScreenshotPlan } from "@/lib/paywall-review-screenshot"

/**
 * Assemble the review screenshot's content from the tenant's OWN paywall + catalogue.
 *
 * Reads the same two tables `/functions/v1/config` serves from, so the image cannot describe a
 * paywall the SDK would not render. Kept apart from the renderer because the renderer is a `.tsx`
 * that pulls in `next/og`, and the sync path wants the data shape without that weight.
 */

type Supa = ReturnType<typeof createClient>

function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "—"
  const symbol =
    currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "USD" ? "$" : ""
  // Zero-decimal display for INR matches how the SDK prints it; elsewhere two decimals.
  const amount = currency === "INR" ? (cents / 100).toFixed(0) : (cents / 100).toFixed(2)
  return symbol ? `${symbol}${amount}` : `${amount} ${currency}`
}

function cadence(interval: string | null): string {
  switch ((interval ?? "").toLowerCase()) {
    case "year":
      return "Billed yearly"
    case "semiannual":
      return "Billed every 6 months"
    case "quarter":
      return "Billed quarterly"
    case "month":
      return "Billed monthly"
    default:
      return "One-time"
  }
}

export async function buildReviewScreenshotInput(
  supabase: Supa,
  tenantId: string,
): Promise<ReviewScreenshotInput | { error: string }> {
  const [{ data: paywall }, { data: products }] = await Promise.all([
    supabase
      .from("tenant_paywall")
      .select("hero_title, hero_subtitle, cta_get_premium, restore_label, primary_color, popular_plan_sku")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_products")
      .select("sku, display_name, type, interval, base_price_cents, base_currency, display_order")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("display_order"),
  ])

  const sellable = (products ?? []).filter((p: { type?: string }) => p.type !== "trial")
  if (sellable.length === 0) {
    // An empty paywall is not a screenshot worth sending to App Review — it would show a purchase
    // surface with nothing to purchase, which invites exactly the rejection it is meant to avoid.
    return { error: "no active products — a review screenshot would show an empty paywall" }
  }

  const popular = (paywall as { popular_plan_sku?: string } | null)?.popular_plan_sku ?? null

  const plans: ReviewScreenshotPlan[] = sellable.map((p: Record<string, unknown>) => ({
    name: String(p.display_name ?? p.sku ?? ""),
    price: formatMoney(p.base_price_cents as number | null, String(p.base_currency ?? "USD")),
    cadence: cadence((p.interval as string | null) ?? null),
    highlight: popular != null && p.sku === popular,
  }))

  const pw = (paywall ?? {}) as Record<string, string | null>
  return {
    heroTitle: pw.hero_title || "Upgrade",
    heroSubtitle: pw.hero_subtitle || "Unlock everything.",
    ctaLabel: pw.cta_get_premium || "Continue",
    restoreLabel: pw.restore_label || "Restore purchases",
    primaryColor: pw.primary_color || "",
    plans,
  }
}
