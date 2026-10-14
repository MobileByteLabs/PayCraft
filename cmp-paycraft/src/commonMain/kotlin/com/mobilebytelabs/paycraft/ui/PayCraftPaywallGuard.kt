package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import org.koin.compose.koinInject

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
 * @param billingManager Leave null to resolve from Koin. Pass one explicitly in previews and
 *   screenshot tests, which have no Koin graph.
 * @param paywall What a non-premium user sees instead of [content]. Leave null for the SDK's own
 *   full-screen paywall, which is the right answer for nearly every host. Supply it when the gated
 *   surface should NAVIGATE to a paywall route rather than render one inline, or to choose a
 *   different [DisplayMode] (e.g. a sheet). This is a presentation choice; it does not let a host
 *   author its own offer UI — the tiers, prices and trial still come from the catalogue.
 * @param content The gated screen.
 */
@Deprecated(
    message = "Split into two gates with smaller, SDK-owned surfaces: PayCraftPremiumGate for a " +
        "premium-only feature, PayCraftRewardedGate for one unlockable by watching an ad. Both drop " +
        "`billingManager` (billing is the SDK's concern — use LocalPayCraftEntitlementOverride in " +
        "previews), drop `onDismiss`/`paywall` (the paywall is presented through PayCraft's own " +
        "internal path so tiers/prices/copy stay dashboard-owned), and make ads optional with a " +
        "persisted 24h grant instead of a permanent content+banner render.",
    replaceWith = ReplaceWith("PayCraftPremiumGate(modifier, loading, content)"),
    level = DeprecationLevel.WARNING,
)
@Composable
fun PayCraftPaywallGuardScreen(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    showAds: Boolean = false,
    ads: (@Composable () -> Unit)? = null,
    loading: (@Composable () -> Unit)? = null,
    billingManager: BillingManager? = null,
    paywall: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    // Nullable param + resolve-in-body rather than `= koinInject()`, because a default argument is
    // evaluated at the CALL SITE: with a default, every @Preview of every screen wrapped in this
    // guard would need a started Koin graph. Same bug class as PayCraftRestore's, fixed the same way.
    val manager = billingManager ?: koinInject()

    // collectAsState, not collectAsStateWithLifecycle: both are StateFlows whose current value is
    // free to read, so the lifecycle-aware variant buys nothing — and it drags LocalLifecycleOwner
    // plus a Main dispatcher into every composable that wraps itself in this guard, which breaks
    // commonTest and previews. Matches PayCraftPremiumBanner, the SDK's existing precedent.
    val isPremium by manager.isPremium.collectAsState()
    val billingState by manager.billingState.collectAsState()
    val isAdFree by PayCraft.isAdFree.collectAsState()

    when {
        isPremium -> Box(modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED)) {
            content()
        }

        // Only BEFORE a verdict. Checked after `isPremium` on purpose: a warm cache can report
        // premium while a refresh is in flight, and an entitled user must not be made to wait.
        billingState is BillingState.Loading ->
            Box(modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_RESOLVING)) {
                loading?.invoke()
            }

        // `isAdFree` is the SDK's OWN ad-gating signal (AC-12, AdFreeEntitlement), not a second
        // derivation of it. It mirrors premium, and the premium branch above already returned, so in
        // practice it is false here — but reading it keeps this guard on the same flow a host is told
        // to gate its ads with (`PayCraft.isAdFree`). A host that pushes ad-free for its own reason
        // (a promo, a grandfathered cohort, an entitlement resolved elsewhere via
        // AdFreeEntitlement.set) therefore stops seeing ads here too, rather than having this guard
        // quietly disagree with every other ad check in the app.
        showAds && ads != null && !isAdFree -> Column(
            modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_AD_SUPPORTED),
        ) {
            content()
            ads()
        }

        // Ad-free but not premium — a host-pushed ad-free cohort. They get the content, no ads, and
        // no paywall: charging at them would contradict the ad-free grant they were just given.
        showAds && ads != null -> Box(
            modifier = modifier.testTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED),
        ) {
            content()
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
