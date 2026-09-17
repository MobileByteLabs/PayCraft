import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { toAlpha2 } from "../country-code.ts"

/**
 * The alpha-3 storefront regression.
 *
 * Measured on an iOS 26 simulator, `Storefront.current` reports `countryCode = "USA"`. The SDK
 * forwards it verbatim, so `/config` receives `Accept-Language: en-USA`. Against live `/config`
 * before the fix: `IN` resolved ₹299.00 INR (source `manual`) while `IND` fell through to $9.99 USD
 * (source `fallback`) — the buyer still saw a price, just the wrong one.
 */

Deno.test("AC-13: StoreKit alpha-3 normalizes to the alpha-2 the data is keyed on", () => {
  assertEquals(toAlpha2("IND"), "IN")
  assertEquals(toAlpha2("USA"), "US")
  assertEquals(toAlpha2("GBR"), "GB")
  assertEquals(toAlpha2("DEU"), "DE")
  assertEquals(toAlpha2("BRA"), "BR")
})

Deno.test("Play's alpha-2 passes through untouched", () => {
  // The other store already speaks alpha-2; normalization must not disturb the working path.
  assertEquals(toAlpha2("IN"), "IN")
  assertEquals(toAlpha2("US"), "US")
})

Deno.test("casing and whitespace are normalized", () => {
  assertEquals(toAlpha2(" ind "), "IN")
  assertEquals(toAlpha2("us"), "US")
})

Deno.test("an unknown alpha-3 degrades to itself rather than null", () => {
  // A storefront Apple adds after this deploy must not erase the signal: a wrong country is
  // recoverable from the caller's next signal, a dropped one silently becomes the default.
  assertEquals(toAlpha2("ZZZ"), "ZZZ")
})

Deno.test("absent input stays absent", () => {
  // Distinct from "unknown": there is no signal to preserve, and the caller substitutes its default.
  assertEquals(toAlpha2(null), null)
  assertEquals(toAlpha2(undefined), null)
  assertEquals(toAlpha2("   "), null)
})

Deno.test("the map covers every ISO 3166-1 alpha-3 code in use", () => {
  // A spot-check across regions — a truncated paste of the table is the likely regression, and it
  // would only show as a wrong price for buyers in whichever block went missing.
  for (const [a3, a2] of [
    ["ZAF", "ZA"], ["NZL", "NZ"], ["ARE", "AE"], ["SGP", "SG"], ["MEX", "MX"],
    ["NOR", "NO"], ["POL", "PL"], ["TUR", "TR"], ["VNM", "VN"], ["EGY", "EG"],
  ]) {
    assertEquals(toAlpha2(a3), a2, `${a3} should normalize to ${a2}`)
  }
})
