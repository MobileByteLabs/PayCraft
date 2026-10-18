package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.core.BillingManager

/**
 * Wraps a screen in an entitlement gate. The consumer writes one composable and the SDK decides
 * what the user actually sees:
 *
 * ```kotlin
 * PayCraftPaywallGuardScreen(onDismiss = navigateBack) {
 *     MyPremiumScreen()
 * }
 * ```
 *
 * Ad-supported free tier — the consumer owns the ad SDK, PayCraft only decides *whether* to ask:
 *
 * ```kotlin
 * PayCraftPaywallGuardScreen(
 *     onDismiss = navigateBack,
 *     showAds = true,
 *     ads = { MyBannerAd() },   // AdMob, AppLovin, whatever — never PayCraft's business
 * ) {
 *     MyScreen()
 * }
 * ```
 *
 * ## What renders
 *
 * | Entitlement | `showAds` + `ads` supplied | Rendered |
 * |---|---|---|
 * | premium  | either | [content] only — **never** [ads]; ad-free is what they bought |
 * | not premium | yes | [content] + [ads] — the ad-supported free tier |
 * | not premium | no  | the SDK paywall, in place of [content] |
 * | still resolving | either | [loading] (default: nothing) |
 *
 * ## Why `isPremium` and not `billingState`
 *
 * The gate reads [BillingManager.isPremium], the SDK's single authoritative gating signal — the same
 * one every other surface gates on. The older [PayCraftPremiumGuard] / [PayCraftPremiumGuardInline]
 * pattern-match `is BillingState.Premium` instead, which is a SECOND derivation of the same truth and
 * can disagree with the rest of the app: a buyer in `PaymentPending`, in offline grace, or in
 * `OwnershipVerified` is entitled by `isPremium` but is not a `BillingState.Premium` instance, so
 * those guards lock out people who have in fact paid.
 *
 * ## Why `Loading` is its own branch
 *
 * `billingState == Loading` means "we do not know yet" — it is not "not premium". Folding it into the
 * locked branch (as the older guards do) shows a paywall to a PAYING customer for the first frames of
 * every cold start, until the entitlement resolves. Showing nothing briefly is the honest answer to a
 * question that has no answer yet.
 *
 * @param onDismiss Called when a non-premium user dismisses the paywall. Hosts usually navigate away
 *   from the gated surface. Not called in the ad-supported path — there is no paywall to dismiss.
 * @param showAds Opt in to the ad-supported free tier. Requires [ads]; `true` with no [ads] slot falls
 *   through to the paywall rather than silently handing out the gated content for free.
 * @param ads The consumer's ad composable. PayCraft never loads, requests, or measures an ad — it only
 *   decides whether this slot is rendered, so no ad SDK enters the SDK's dependency graph.
 * @param loading Rendered while the entitlement is still resolving. Default: nothing.
 * @param loading Shown while entitlement is still resolving.
 *   screenshot tests, which have no Koin graph.
 * @param paywall What a non-premium user sees instead of [content]. Leave null for the SDK's own
 *   full-screen paywall, which is the right answer for nearly every host. Supply it when the gated
 *   surface should NAVIGATE to a paywall route rather than render one inline, or to choose a
 *   different [DisplayMode] (e.g. a sheet). This is a presentation choice; it does not let a host
 *   author its own offer UI — the tiers, prices and trial still come from the catalogue.
 * @param content The gated screen.
 */
@Deprecated(
    message = "Split into two gates with smaller, SDK-owned surfaces: PayCraftGate for a " +
        "premium-only feature, PayCraftAdGate for one unlockable by watching an ad. Both drop " +
        "`billingManager` (billing is the SDK's concern — use LocalPayCraftEntitlementOverride in " +
        "previews), drop `onDismiss`/`paywall` (the paywall is presented through PayCraft's own " +
        "internal path so tiers/prices/copy stay dashboard-owned), and make ads optional with a " +
        "persisted 24h grant instead of a permanent content+banner render.",
    replaceWith = ReplaceWith("PayCraftGate(modifier, loading, content)"),
    level = DeprecationLevel.WARNING,
)
@Composable
fun PayCraftPaywallGuardScreen(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    showAds: Boolean = false,
    ads: (@Composable () -> Unit)? = null,
    loading: (@Composable () -> Unit)? = null,
    paywall: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    // Entitlement comes from the SAME resolver the replacement gates use, which honours
    // LocalPayCraftEntitlementOverride before touching Koin. Two things fall out of that: the
    // deprecation message's promise that "previews use LocalPayCraftEntitlementOverride" is now
    // true here too, and this guard stops deriving entitlement a second way — it used to read
    // `isPremium` + `billingState` + `isAdFree` itself and could disagree with the gate replacing it.
    val verdict = rememberGateVerdict()
    val isPremium = verdict.entitled

    when {
        isPremium -> Box(modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED)) {
            content()
        }

        // Only BEFORE a verdict. Checked after `isPremium` on purpose: a warm cache can report
        // premium while a refresh is in flight, and an entitled user must not be made to wait.
        verdict.resolving ->
            Box(modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_RESOLVING)) {
                loading?.invoke()
            }

        // No `&& !isAdFree` guard any more, and no ad-free branch below: `verdict.entitled` is
        // `isPremium || isAdFree`, so a host-pushed ad-free cohort (a promo, a grandfathered tier,
        // AdFreeEntitlement.set) already took the unlocked branch at the top. Reaching here means
        // NOT entitled by either signal, which is exactly who should see ads. The previous version
        // checked ad-free twice — once to skip this branch and once in a branch below that rendered
        // the same unlocked Box as the top — because entitlement was derived here rather than by the
        // shared resolver.
        showAds && ads != null -> Column(
            modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_AD_SUPPORTED),
        ) {
            content()
            ads()
        }

        paywall != null -> Box(modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_LOCKED)) {
            paywall()
        }

        else -> PayCraftPaywallComposable(
            onDismiss = onDismiss,
            displayMode = DisplayMode.FullScreen,
            modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_LOCKED),
        )
    }
}
