// App Store refund requests (migration 207): the consumption information PayCraft sends Apple declares only what it
// knows — delivered, how much of the subscription period was used, how long the customer has been a customer, and
// the tenant's refund preference — and leaves everything else "undeclared" (0).
// Run: SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --no-check --allow-env supabase/functions/__tests__/appstore-consumption.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildConsumptionRequest, consumptionStatus, tenureBucket } from "../_shared/appstore-consumption.ts"

const DAY = 86_400_000
const NOW = 1_800_000_000_000

Deno.test("account tenure buckets follow Apple's day ranges", () => {
  assertEquals(tenureBucket(undefined, NOW), 0)
  assertEquals(tenureBucket(NOW + DAY, NOW), 0, "a future date is not a tenure")
  assertEquals(tenureBucket(NOW - 1 * DAY, NOW), 1)
  assertEquals(tenureBucket(NOW - 5 * DAY, NOW), 2)
  assertEquals(tenureBucket(NOW - 20 * DAY, NOW), 3)
  assertEquals(tenureBucket(NOW - 60 * DAY, NOW), 4)
  assertEquals(tenureBucket(NOW - 120 * DAY, NOW), 5)
  assertEquals(tenureBucket(NOW - 300 * DAY, NOW), 6)
  assertEquals(tenureBucket(NOW - 400 * DAY, NOW), 7)
})

Deno.test("a subscription is consumed as its period passes; a one-time purchase is undeclared", () => {
  const sub = { type: "Auto-Renewable Subscription", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY }
  assertEquals(consumptionStatus(sub, NOW), 2)
  assertEquals(consumptionStatus({ ...sub, purchaseDate: NOW + DAY }, NOW), 1)
  assertEquals(consumptionStatus({ ...sub, expiresDate: NOW - DAY }, NOW), 3)
  assertEquals(consumptionStatus({ type: "Consumable", purchaseDate: NOW - DAY }, NOW), 0)
})

Deno.test("the request declares only known facts and the tenant's preference", () => {
  const tx = {
    type: "Auto-Renewable Subscription", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY,
    originalPurchaseDate: NOW - 100 * DAY, appAccountToken: "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b",
  }
  assertEquals(buildConsumptionRequest(tx, 2, NOW), {
    customerConsented: true, consumptionStatus: 2, platform: 1, sampleContentProvided: false, deliveryStatus: 0,
    appAccountToken: tx.appAccountToken, accountTenure: 5, playTime: 0, lifetimeDollarsRefunded: 0,
    lifetimeDollarsPurchased: 0, userStatus: 0, refundPreference: 2,
  })
  const odd = buildConsumptionRequest({ ...tx, appAccountToken: "not-a-uuid" }, 9, NOW)
  assertEquals(odd.appAccountToken, "", "Apple accepts only a UUID or an empty string")
  assertEquals(odd.refundPreference, 0, "an out-of-range preference is sent as undeclared")
})
