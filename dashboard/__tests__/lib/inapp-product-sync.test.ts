/**
 * Consumable / one-time provider sync — the pure pieces.
 *
 * Both stores accept a wrong value here happily, and neither failure surfaces until a real customer
 * is involved:
 *
 *  - Play one-time products moved from the legacy `inappproducts` resource (retired — every call
 *    402/403s with "Please migrate to the new publishing API") to `monetization.onetimeproducts`,
 *    which takes a `Money` of units+nanos instead of a `priceMicros` string. The listings shape
 *    changed with it, from a language-keyed object to an array.
 *  - Apple's `inAppPurchaseType` is IMMUTABLE after creation. A coin pack created as NON_CONSUMABLE
 *    can be bought exactly once per Apple ID, forever, and the only fix is a new product under a
 *    new id — so this mapping has to be right the first time, not fixable later.
 *  - Play keys regional prices by REGION while PayCraft carries them by CURRENCY. Comparing the two
 *    directly ("USD" vs "US") silently prices almost nothing, which looks like a successful sync.
 */

import { ascInAppPurchaseType, sanitizeAscInAppProductId } from "@/lib/appstore-inapp-sync"
import { oneTimeListings, regionalConfigsFor, sanitizeInAppProductId } from "@/lib/googleplay-inapp-sync"

describe("regionalConfigsFor", () => {
  it("maps PayCraft currencies to Play REGIONS, not to currency codes", () => {
    // The bug this pins: comparing "USD" against a region code. It matches almost nothing, so the
    // product syncs with a near-empty region set and looks successful.
    const out = regionalConfigsFor([
      { currency: "USD", amountCents: 199 },
      { currency: "GBP", amountCents: 169 },
    ])
    expect(out.map((r) => r.regionCode)).toEqual(["US", "GB"])
    expect(out[0].price).toEqual({ currencyCode: "USD", units: "1", nanos: 990000000 })
    expect(out.every((r) => r.availability === "AVAILABLE")).toBe(true)
  })

  it("keeps the FIRST price when two currencies collapse to one region", () => {
    // Many currencies map to one region; a later row must not silently overwrite an earlier price.
    const out = regionalConfigsFor([
      { currency: "USD", amountCents: 199 },
      { currency: "USD", amountCents: 999 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].price.units).toBe("1")
  })

  it("drops a currency that maps to no Play region", () => {
    expect(regionalConfigsFor([{ currency: "ZZZ", amountCents: 100 }])).toEqual([])
  })

  it("encodes money as units+nanos, the monetization.* Money shape", () => {
    // The legacy resource took `priceMicros` (minor units x 10,000, a STRING). This resource takes
    // a Money. A priceMicros value sent here is not a 10x error, it is a rejected request — which
    // is the safer failure, and the reason toPriceMicros was deleted rather than ported.
    const [row] = regionalConfigsFor([{ currency: "EUR", amountCents: 1000 }])
    expect(row.price).toEqual({ currencyCode: "EUR", units: "10", nanos: 0 })
  })
})

describe("oneTimeListings", () => {
  it("is an ARRAY of languageCode entries, not a language-keyed object", () => {
    // `inappproducts` keyed listings by language ({"en-US": {...}}); this resource takes a list.
    // Sending the old shape is a 400 on a required field.
    const l = oneTimeListings("300 Ripples", 300)
    expect(Array.isArray(l)).toBe(true)
    expect(l[0].languageCode).toBe("en-US")
    expect(l[0].title).toBe("300 Ripples")
  })

  it("describes what the pack GRANTS when no store description is given", () => {
    expect(oneTimeListings("300 Ripples", 300)[0].description).toBe("Adds 300 to your balance instantly.")
  })

  it("respects Play's length caps", () => {
    const l = oneTimeListings("x".repeat(200), 300, "y".repeat(200))
    expect(l[0].title.length).toBeLessThanOrEqual(55)
    expect(l[0].description.length).toBeLessThanOrEqual(80)
  })
})

describe("ascInAppPurchaseType", () => {
  it("maps a consumable to CONSUMABLE", () => {
    expect(ascInAppPurchaseType("consumable")).toBe("CONSUMABLE")
  })

  it("maps everything else to NON_CONSUMABLE", () => {
    // The dangerous direction is the other one: a pack typed NON_CONSUMABLE is buyable once per
    // Apple ID and cannot be corrected in place.
    expect(ascInAppPurchaseType("one_time")).toBe("NON_CONSUMABLE")
    expect(ascInAppPurchaseType("subscription")).toBe("NON_CONSUMABLE")
  })
})

describe("product id sanitisation", () => {
  it("makes a Play-legal managed product id", () => {
    expect(sanitizeInAppProductId("cappy_ripples_550")).toBe("cappy_ripples_550")
    // Trailing separators are stripped — Play rejects an id ending in "_" or ".".
    expect(sanitizeInAppProductId("Cappy Ripples 550!")).toBe("cappy_ripples_550")
  })

  it("never returns an empty id", () => {
    // An empty sku would otherwise produce "" and create a nameless product.
    expect(sanitizeInAppProductId("!!!")).toBe("product")
    expect(sanitizeInAppProductId("")).toBe("product")
  })

  it("makes an ASC-legal reverse-DNS product id", () => {
    expect(sanitizeAscInAppProductId("com.mobilebytesensei.cappy", "cappy_ripples_550")).toBe(
      "com.mobilebytesensei.cappy.cappyripples550",
    )
  })

  it("falls back rather than emitting a trailing-dot id", () => {
    expect(sanitizeAscInAppProductId("com.example.app", "!!!")).toBe("com.example.app.product")
  })
})
