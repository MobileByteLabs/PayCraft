import { ImageResponse } from "next/og"

/**
 * Render the tenant's paywall to a PNG, server-side, from the SAME data the SDK renders from.
 *
 * WHY GENERATE RATHER THAN ASK FOR AN UPLOAD
 * App Store requires a review screenshot per subscription, and without one every subscription stays
 * in `MISSING_METADATA` however complete the rest is. The obvious answer — "upload a screenshot of
 * your paywall" — puts a manual, easily-stale step in front of every release: the paywall is SERVER
 * DRIVEN, so its copy, prices and plan list change from this dashboard, and a hand-captured PNG is
 * out of date the moment someone edits a price.
 *
 * Rendering from `tenant_paywall` + `tenant_products` means the screenshot is always a picture of
 * what the SDK will actually show. It is regenerated on sync, so it cannot drift.
 *
 * WHAT IT IS NOT: a pixel-exact replica of the Compose paywall. It is a faithful representation of
 * the same content — hero, plans with real prices and cadences, the real CTA label — which is what
 * an App Review engineer needs in order to recognise the purchase. Claiming pixel fidelity would be
 * false; the SDK renders natively and this renders with Satori.
 *
 * Portrait at iPhone proportions so it reads as a phone screen rather than a web page.
 */

export interface ReviewScreenshotPlan {
  name: string
  price: string
  cadence: string
  highlight?: boolean
}

export interface ReviewScreenshotInput {
  heroTitle: string
  heroSubtitle: string
  ctaLabel: string
  restoreLabel: string
  primaryColor: string
  plans: ReviewScreenshotPlan[]
}

const WIDTH = 1179
const HEIGHT = 2556

/** Readable default that matches the SDK's warm neutral surface rather than stark white. */
const SURFACE = "#FBF6EF"
const INK = "#2A2018"
const MUTED = "#6B5B4B"

export async function renderPaywallReviewScreenshot(
  input: ReviewScreenshotInput,
): Promise<Uint8Array> {
  const accent = input.primaryColor || "#7A5C42"

  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: SURFACE,
          padding: "96px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 72 }}>
          {/*
            A plain accent tile, NOT a glyph. The first version rendered a ★ and Satori's default
            font has no such codepoint, so it came out as a tofu box — a broken character is exactly
            the kind of detail that makes a review screenshot look like a mistake. Drawn with CSS so
            it cannot depend on font coverage.
          */}
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: 44,
              background: "#EFE4D7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 48,
            }}
          >
            <div style={{ width: 84, height: 84, borderRadius: 24, background: accent, opacity: 0.85 }} />
          </div>
          <div style={{ fontSize: 84, fontWeight: 700, color: INK, textAlign: "center" }}>
            {input.heroTitle}
          </div>
          <div
            style={{
              fontSize: 40,
              color: MUTED,
              textAlign: "center",
              marginTop: 28,
              lineHeight: 1.35,
              maxWidth: 900,
            }}
          >
            {input.heroSubtitle}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28, flex: 1 }}>
          {input.plans.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: `${p.highlight ? 6 : 2}px solid ${p.highlight ? accent : "#E3D6C6"}`,
                background: p.highlight ? "#F3E9DC" : "transparent",
                borderRadius: 32,
                padding: "40px 44px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 52, fontWeight: 600, color: INK }}>{p.name}</div>
                <div style={{ fontSize: 34, color: MUTED, marginTop: 10 }}>{p.cadence}</div>
              </div>
              <div style={{ fontSize: 56, fontWeight: 700, color: INK }}>{p.price}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 64 }}>
          <div
            style={{
              width: "100%",
              background: accent,
              color: "#FFFFFF",
              fontSize: 52,
              fontWeight: 600,
              borderRadius: 999,
              padding: "44px 0",
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {input.ctaLabel}
          </div>
          <div style={{ fontSize: 34, color: MUTED, letterSpacing: 2, marginTop: 40 }}>
            {input.restoreLabel.toUpperCase()}
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )

  return new Uint8Array(await res.arrayBuffer())
}
