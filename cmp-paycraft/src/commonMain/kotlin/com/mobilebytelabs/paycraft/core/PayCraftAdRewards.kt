package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.debug.PayCraftLogger

/**
 * Watch an ad, earn currency — the third way units enter a balance, beside buying and in-app effort.
 *
 * ## Why the SDK does not show the ad
 *
 * PayCraft owns the MONEY path, not someone else's ad SDK. AdMob, AppLovin and the rest each take a
 * firm position on Activity / UIViewController ownership and ship large platform-specific
 * dependencies; adopting one would force it on every consumer, including those who sell no ads at
 * all. So the host shows the ad — it already has the network it chose — and binds this seam exactly
 * the way it binds `identity`. Everything after "the ad completed" is the SDK's.
 *
 * ## What makes the reward trustworthy
 *
 * **Not this interface.** A client saying "I watched an ad" is a client minting currency with no
 * attention actually sold — the same shape as the subject-id hole migration 159 closed, and the
 * email hole 162 closed. So completing an ad here credits NOTHING directly.
 *
 * Instead the ad network's own **server-side verification (SSV)** callback reaches PayCraft's
 * `ad-reward` edge function, which checks the network's signature before crediting
 * `entitlement_balance_ledger` with `reason = 'ad_reward'` via a service-role RPC that has no
 * client-callable overload. This class's only job is to carry enough context in the ad request for
 * that callback to know WHO and WHICH SKU — and then to reconcile, because the credit lands
 * server-side and out of band.
 *
 * ## Not to be confused with `PayCraftAdUnlock`
 *
 * [PayCraftAdUnlock] grants a time-boxed FEATURE unlock and is deliberately local-only: a free
 * feature has no transferable value, so a round-trip to prove it would cost more than it protects.
 * Currency does have transferable value. The two must not be merged, and this one can never be
 * local.
 */
public fun interface AdRewardProvider {

    /**
     * Show a rewarded ad and return true only if the user EARNED the reward (watched to the point
     * the network rewards), false if they dismissed it early or no ad was available.
     *
     * [customData] must be passed to the ad network verbatim as its custom-data / server-side
     * verification payload (AdMob: `ServerSideVerificationOptions.customData`). It is how the SSV
     * callback attributes the reward to this device and sku — without it the callback arrives with
     * nothing to credit, and the user watches an ad for nothing.
     *
     * Throwing is treated as "no reward".
     */
    public suspend fun showRewardedAd(customData: String, userId: String): Boolean
}

/**
 * Drives one watch-to-earn round: show the ad, then adopt whatever the server says.
 *
 * Deliberately returns the RECONCILED balance rather than "how much you earned". The client never
 * learns the reward amount from the ad — the network's callback decides it server-side, and a
 * client-computed delta would be a number the user could disagree with and the server would
 * overrule a moment later.
 */
public class PayCraftAdRewards internal constructor(
    private val provider: AdRewardProvider?,
    private val balances: PayCraftBalances,
    private val deviceToken: () -> String?,
) {

    /** True when the host bound a provider — hosts hide the watch-to-earn affordance when false. */
    public val isAvailable: Boolean get() = provider != null

    /**
     * Show a rewarded ad for [sku] and return the balance after reconciling.
     *
     * Returns null when no provider is bound, the device is unregistered, or the user did not earn
     * the reward — all of which are ordinary outcomes a host renders as "no reward this time",
     * never as an error.
     *
     * The reconcile is not optional and not instant: the SSV callback is an out-of-band server call
     * that may land after this returns. A host that shows a stale balance here and never reconciles
     * again will leave the user believing the ad paid nothing.
     */
    public suspend fun watchAndEarn(sku: String): Int? {
        val ads = provider ?: return null
        val token = deviceToken()
        if (token.isNullOrBlank()) {
            // No registered device means the callback has nothing to attribute the reward to, so
            // showing the ad would spend the user's attention for certain nothing.
            PayCraftLogger.onError("ad-reward", "no registered device — not showing an ad")
            return null
        }

        // sku and device token, in the shape the ad-reward edge function parses. The token (not a
        // subject id) for the same reason every other client call carries one: a caller must only
        // ever be able to name ITSELF.
        val customData = "$token|$sku"

        val earned = runCatching { ads.showRewardedAd(customData, token) }.getOrDefault(false)
        if (!earned) return null

        // The credit is already in flight server-side; this adopts it. If the callback has not
        // landed yet the number is simply unchanged, and the next reconcile picks it up — which is
        // why the balance is a flow the host observes rather than a one-shot answer.
        balances.reconcile(sku)
        return balances.balanceOf(sku)
    }
}
