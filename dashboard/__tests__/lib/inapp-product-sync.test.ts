/**
 * Consumable / one-time provider sync — the pure pieces.
 *
 * Both stores accept a wrong value here happily, and neither failure surfaces until a real customer
 * is involved:
 *
 *  - `priceMicros` is minor-units × 10,000. An exponent slip is a 10× or 100× mispricing that the
 *    Play API stores without complaint; the first signal is a charge.
 *  - Apple's `inAppPurchaseType` is IMMUTABLE after creation. A coin pack created as NON_CONSUMABLE
 *    can be bought exactly once per Apple ID, forever, and the only fix is a new product under a
 *    new id — so this mapping has to be right the first time, not fixable later.
 *  - Play keys regional prices by REGION while PayCraft carries them by CURRENCY. Comparing the two
 *    directly ("USD" vs "US") silently prices almost nothing, which looks like a successful sync.
 */

import { ascInAppPurchaseType, sanitizeAscInAppProductId } from "@/lib/appstore-inapp-sync"
import { sanitizeInAppProductId, toPriceMicros } from "@/lib/googleplay-inapp-sync"

describe("toPriceMicros", () => {
  it("scales decimal currencies by 10,000", () => {
    expect(toPriceMicros("USD", 499)).toBe("4990000") // $4.99
    expect(toPriceMicros("USD", 99)).toBe("990000") // $0.99
    expect(toPriceMicros("EUR", 1000)).toBe("10000000") // €10.00
  })

  it("scales zero-decimal currencies by 1,000,000", () => {
    // ¥500 is 500 WHOLE yen, not 5.00. Treating it as minor units would undercharge 100×.
    expect(toPriceMicros("JPY", 500)).toBe("500000000")
    expect(toPriceMicros("KRW", 5000)).toBe("5000000000")
  })

  it("is case-insensitive about the currency code", () => {
    expect(toPriceMicros("jpy", 500)).toBe(toPriceMicros("JPY", 500))
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
