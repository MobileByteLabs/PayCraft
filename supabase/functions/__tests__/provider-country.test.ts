// The country a purchase is attributed to comes from the PROVIDER (paycraft-attempt-observability sub-plan 07):
// Google Play's subscriptionsv2 `regionCode` (alpha-2) and the App Store transaction's `storefront` (alpha-3).
// Analytics' "paid by country" reads this, never a request header the edge does not send.
// Run: SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --no-check --allow-env supabase/functions/__tests__/provider-country.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { appleToCanonical, googleToCanonical } from "../_shared/entitlement-reconcile.ts"

const jws = (payload: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`

function appleWithStorefront(storefront: string | undefined) {
  return appleToCanonical({
    data: [{
      lastTransactions: [{
        originalTransactionId: "otx",
        status: 1,
        signedTransactionInfo: jws({
          productId: "pro.monthly", appAccountToken: "u-1", expiresDate: Date.now() + 3600e3,
          signedDate: Date.now(), environment: "Production", storefront,
        }),
        signedRenewalInfo: jws({ autoRenewStatus: 1 }),
      }],
    }],
  }, "otx")
}

function play(regionCode: string | undefined) {
  return googleToCanonical({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    regionCode,
    lineItems: [{ productId: "pro_monthly", expiryTime: new Date(Date.now() + 3600e3).toISOString(),
                  autoRenewingPlan: { autoRenewEnabled: true } }],
  }, "tok-1", "u-1")
}

Deno.test("Play: regionCode is the purchase's country", () => {
  assertEquals(play("IN").country, "IN")
  assertEquals(play("us").country, "US")
})

Deno.test("App Store: the alpha-3 storefront becomes alpha-2", () => {
  assertEquals(appleWithStorefront("IND").country, "IN")
  assertEquals(appleWithStorefront("USA").country, "US")
})

Deno.test("no provider country → null, never a guess", () => {
  assertEquals(play(undefined).country, null)
  assertEquals(appleWithStorefront(undefined).country, null)
})
