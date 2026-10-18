package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.PayCraftAdUnlock
import com.mobilebytelabs.paycraft.model.BillingState
import org.koin.compose.koinInject

/**
 * Forces the gates' entitlement verdict, for `@Preview` and screenshot tests ONLY.
 *
 * The gates take no `billingManager` parameter on purpose — billing is the SDK's concern and a
 * consumer should never have to name it to gate a feature. But a `@Preview` of a consumer screen
 * wrapped in a gate has no Koin graph, and a DI lookup there throws
 * "KoinApplication has not been started". This is the sanctioned way out:
 *
 * ```kotlin
 * @Preview
 * @Composable
 * private fun MyScreenPremiumPreview() {
 *     CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) {
 *         MyScreen()        // the gate inside renders its premium branch, no Koin needed
 *     }
 * }
 * ```
 *
 * `null` (the default) means "ask the SDK" — so production is never affected by this existing.
 *
 * THREE states, not a Boolean. `Resolving` is reachable only through the real BillingManager, so a
 * Boolean override could not drive it and every test of that branch had to stand up a Koin graph —
 * which made them hostage to whether another test in the same JVM had started a global Koin context,
 * i.e. intermittently red for reasons unrelated to the gate. A preview also legitimately wants to
 * show the resolving frame.
 */
enum class PayCraftGateState { Entitled, NotEntitled, Resolving }

val LocalPayCraftEntitlementOverride = compositionLocalOf<PayCraftGateState?> { null }

/**
 * Resolved entitlement for the gates: the preview override if one is provided, else the SDK's own
 * signals.
 *
 * Gates on `isPremium` — the SDK's single authoritative gating signal — plus [PayCraft.isAdFree],
 * the flow a host is told to gate ad rendering with (AC-12), so a host-granted ad-free cohort counts
 * as entitled here too. Deliberately NOT `billingState is BillingState.Premium`: that is a second
 * derivation of the same truth and locks out a buyer in `PaymentPending`, in offline grace, or in
 * `OwnershipVerified`.
 */
internal class GateVerdict(val entitled: Boolean, val resolving: Boolean)

@Composable
internal fun rememberGateVerdict(): GateVerdict {
    when (LocalPayCraftEntitlementOverride.current) {
        PayCraftGateState.Entitled -> return GateVerdict(entitled = true, resolving = false)
        PayCraftGateState.NotEntitled -> return GateVerdict(entitled = false, resolving = false)
        PayCraftGateState.Resolving -> return GateVerdict(entitled = false, resolving = true)
        null -> Unit // fall through to the SDK
    }

    val manager = koinInject<BillingManager>()
    val isPremium by manager.isPremium.collectAsState()
    val billingState by manager.billingState.collectAsState()
    val isAdFree by PayCraft.isAdFree.collectAsState()
    return gateVerdictOf(isPremium = isPremium, isAdFree = isAdFree, billingState = billingState)
}

/**
 * The derivation itself, with no Compose and no Koin.
 *
 * Split out because this is the part that can be WRONG, and testing it through a composable meant
 * standing up a Koin graph — which made those tests hostage to whether another test in the same JVM
 * had started a global Koin context. It is also now the single derivation shared by the live gates
 * AND the deprecated guards, so it is worth asserting directly rather than twice over indirectly.
 *
 * `entitled` is `isPremium || isAdFree`, NOT `billingState is BillingState.Premium`:
 *
 *  - [BillingState.PaymentPending] is not a `Premium` instance, so matching on the state locks out
 *    someone the store has already taken money from.
 *  - an offline buyer in grace, and one in `OwnershipVerified`, are entitled everywhere else in the
 *    app — a gate disagreeing with `isPremium` is a gate disagreeing with the rest of the SDK.
 *  - [PayCraft.isAdFree] is the SDK's own ad-gating signal (AC-12). A host-granted ad-free cohort
 *    (a promo, a grandfathered tier, `AdFreeEntitlement.set`) counts as entitled here too.
 *
 * `resolving` is checked AFTER entitlement by every caller: a warm cache can report premium while a
 * refresh is in flight, and an entitled user must not be made to wait behind a spinner.
 */
internal fun gateVerdictOf(isPremium: Boolean, isAdFree: Boolean, billingState: BillingState): GateVerdict =
    GateVerdict(
        entitled = isPremium || isAdFree,
        resolving = billingState is BillingState.Loading,
    )

/**
 * Wraps a premium-only feature. Two arguments in the common case — the modifier and the content.
 *
 * ```kotlin
 * PayCraftGate {
 *     DeepInsightsCard()
 * }
 * ```
 *
 * - entitled → [content]
 * - still resolving → [loading] (default: nothing; NOT the paywall, see below)
 * - otherwise → the SDK presents its own paywall, in place of [content]
 *
 * ## The paywall is the SDK's, not the host's
 *
 * Non-entitled triggers [PayCraft.presentPaywallIfNeeded] and renders the paywall from
 * [PayCraft.paywallPresentation] — the same internal presentation path `presentPaywall()` drives. The
 * host passes no paywall, no callback and no copy, so tiers, prices, trial length and wording all
 * come from the published workflow and change without an app release. A host-authored lock screen
 * (what [PayCraftPremiumGuard] does) re-states the offer in app code, which is exactly how copy comes
 * to contradict the dashboard.
 *
 * ## Why `resolving` is not folded into the locked branch
 *
 * `BillingState.Loading` means "we do not know yet", not "not premium". Treating them alike shows a
 * paywall to a PAYING customer for the first frames of every cold start.
 *
 * @param loading Rendered while entitlement is still resolving. Default: nothing.
 * @param displayMode Shape of the paywall shown in place of [content]. [DisplayMode.FullScreen] (the
 *   default) suits a whole screen or a route. Use [DisplayMode.Banner] when the gate wraps a
 *   COMPONENT inside an existing layout — a full-screen paywall nested in a scrolling column fights
 *   its parent for space and reads as a broken layout rather than an offer.
 */
@Composable
fun PayCraftGate(
    modifier: Modifier = Modifier,
    loading: (@Composable () -> Unit)? = null,
    displayMode: DisplayMode = DisplayMode.FullScreen,
    content: @Composable () -> Unit,
) {
    val verdict = rememberGateVerdict()

    when {
        verdict.entitled -> Box(modifier = modifier.testTag(PayCraftTestTags.GATE_UNLOCKED)) { content() }

        verdict.resolving -> Box(modifier = modifier.testTag(PayCraftTestTags.GATE_RESOLVING)) {
            loading?.invoke()
        }

        else -> InternalPaywall(modifier, displayMode)
    }
}

/**
 * Wraps a feature unlockable EITHER by subscribing OR by watching a rewarded ad.
 *
 * ```kotlin
 * PayCraftAdGate(
 *     featureKey = "deep-insights",
 *     ads = { onRewardEarned -> MyRewardedAd(onComplete = onRewardEarned) },
 * ) {
 *     DeepInsightsCard()
 * }
 * ```
 *
 * - entitled, or an unexpired ad grant covers [featureKey] → [content]
 * - still resolving → [loading]
 * - otherwise → the SDK's choice surface: **Watch an ad** / **Upgrade**
 *     - Watch → renders [ads]; when the host reports the reward, [PayCraftAdUnlock.grant] records a
 *       [unlockDurationMillis] window and [content] appears
 *     - Upgrade → the SDK's own paywall
 *
 * ## [ads] is optional, and omitting it is meaningful
 *
 * `null` means this host has no rewarded-ad inventory, so there is nothing to offer: the gate behaves
 * exactly like [PayCraftGate]. It does NOT fall through to the content — a gate that opens
 * because the host forgot to wire an ad SDK is the one failure mode here that costs money.
 *
 * ## PayCraft never touches an ad SDK
 *
 * [ads] receives an `onRewardEarned` callback and nothing else. The host owns AdMob/AppLovin/whatever,
 * decides what counts as a completed view, and calls back. No ad dependency enters this SDK's graph,
 * and the SDK cannot be blamed for a reward the host granted on a dismissed ad — call back on
 * COMPLETION, not on show.
 *
 * @param featureKey Stable id for this feature. Grants are per-key, so unlocking insights does not
 *   unlock soundscapes. Keep it stable across releases or existing grants are orphaned.
 * @param unlockDurationMillis How long a reward lasts. Default 24h ([PayCraftAdUnlock.DEFAULT_UNLOCK_MILLIS]).
 */
@Composable
fun PayCraftAdGate(
    featureKey: String,
    modifier: Modifier = Modifier,
    unlockDurationMillis: Long = PayCraftAdUnlock.DEFAULT_UNLOCK_MILLIS,
    displayMode: DisplayMode = DisplayMode.FullScreen,
    ads: (@Composable (onRewardEarned: () -> Unit) -> Unit)? = null,
    loading: (@Composable () -> Unit)? = null,
    lockTitle: String = "Unlock this feature",
    lockDescription: String = "Watch a short ad to unlock it for a day, or subscribe to keep it unlocked.",
    watchAdLabel: String = "Watch an ad",
    upgradeLabel: String = "Upgrade",
    content: @Composable () -> Unit,
) {
    val verdict = rememberGateVerdict()

    // Recompose when a grant lands or expires: `isUnlocked` is a plain store read, so without
    // observing the revision nothing would tell this gate that the reward just arrived.
    val revision by PayCraftAdUnlock.revision.collectAsState()
    val adUnlocked = remember(featureKey, revision) { PayCraftAdUnlock.isUnlocked(featureKey) }

    var showingAd by remember(featureKey) { mutableStateOf(false) }
    var upgrading by remember(featureKey) { mutableStateOf(false) }

    when {
        verdict.entitled || adUnlocked ->
            Box(modifier = modifier.testTag(PayCraftTestTags.GATE_UNLOCKED)) { content() }

        verdict.resolving -> Box(modifier = modifier.testTag(PayCraftTestTags.GATE_RESOLVING)) {
            loading?.invoke()
        }

        upgrading -> InternalPaywall(modifier, displayMode)

        showingAd && ads != null -> Box(modifier = modifier.testTag(PayCraftTestTags.GATE_AD_PLAYING)) {
            ads { PayCraftAdUnlock.grant(featureKey, unlockDurationMillis) }
        }

        // No ad inventory → identical to PayCraftGate. Fails CLOSED.
        ads == null -> InternalPaywall(modifier, displayMode)

        else -> RewardedChoice(
            modifier = modifier,
            title = lockTitle,
            description = lockDescription,
            watchAdLabel = watchAdLabel,
            upgradeLabel = upgradeLabel,
            onWatchAd = { showingAd = true },
            onUpgrade = { upgrading = true },
        )
    }
}

/**
 * The SDK's paywall, presented through its own internal path rather than handed to the caller.
 *
 * [PayCraft.presentPaywallIfNeeded] is a no-op for an entitled buyer, so this is safe even if a race
 * flips entitlement between the branch and the effect.
 */
@Composable
private fun InternalPaywall(modifier: Modifier, displayMode: DisplayMode) {
    LaunchedEffect(Unit) { PayCraft.presentPaywallIfNeeded() }
    PayCraftPaywallComposable(
        onDismiss = { PayCraft.dismissPaywall() },
        displayMode = displayMode,
        modifier = modifier.testTag(PayCraftTestTags.GATE_LOCKED),
    )
}

@Composable
private fun RewardedChoice(
    modifier: Modifier,
    title: String,
    description: String,
    watchAdLabel: String,
    upgradeLabel: String,
    onWatchAd: () -> Unit,
    onUpgrade: () -> Unit,
) {
    Box(
        modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.GATE_REWARDED_CHOICE),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 360.dp).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onWatchAd,
                modifier = Modifier.fillMaxWidth().height(52.dp).testTag(PayCraftTestTags.GATE_WATCH_AD_BUTTON),
            ) {
                Icon(Icons.Default.PlayCircle, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text(watchAdLabel)
            }
            Spacer(Modifier.height(8.dp))
            // Upgrade is the SECONDARY affordance deliberately: the free path must not be the
            // de-emphasised one, or the gate becomes a dark pattern (NFR-006-shaped concern).
            OutlinedButton(
                onClick = onUpgrade,
                modifier = Modifier.fillMaxWidth().height(52.dp).testTag(PayCraftTestTags.GATE_UPGRADE_BUTTON),
            ) {
                Text(upgradeLabel)
            }
        }
    }
}

/**
 * Wraps a Plus-only feature SOFTLY: the content stays visible and the Plus affordance is additive.
 *
 * ```kotlin
 * PayCraftTeaseGate(enabled = soundscape.plusOnly) {
 *     SoundscapeTile(soundscape, onPlay = { play(soundscape) })
 * }
 * ```
 *
 * - entitled, or `enabled = false` → [content] exactly as written, nothing added
 * - not entitled → [content] still renders, PLUS a Plus [badge] and an interaction shield that opens
 *   the SDK paywall instead of letting the tap through
 *
 * ## Why this exists alongside [PayCraftGate]
 *
 * A hard gate replaces the content with a paywall. Many products deliberately do the opposite: show
 * what Plus unlocks, let it be browsed, and intercept only the ACTION. cappy requires this in writing —
 * "a SOFT Plus lock, never a hard wall (NFR-006)" across soundscapes, insights, movements,
 * act-of-kindness and shop cosmetics — and before this gate existed each of those hand-rolled its own
 * chip, its own `isPremium` plumbing and its own paywall navigation. Five implementations of one idea.
 *
 * ## It SHIELDS, it does not merely decorate
 *
 * This is the part a badge-only helper gets wrong. A locked soundscape tile is one big clickable; if
 * the gate only overlaid a chip, the underlying `onPlay` would still fire and premium audio would
 * play. The shield is a transparent click-absorbing layer ABOVE [content], so the tap reaches the
 * paywall and never the action beneath. [content] therefore needs no `isPremium` parameter and no
 * locked branch — that plumbing is what this removes.
 *
 * ## `enabled` is the host's one input, and it has to be
 *
 * WHICH items are Plus-only is app/catalogue data (`soundscape.plusOnly`, `item.plusOnly`), not
 * something the SDK can know. Everything else — entitlement, the chip, the paywall — is the SDK's.
 *
 * ## Resolving shows CONTENT, not a lock
 *
 * Unlike [PayCraftGate], an unresolved entitlement renders [content] ungated. A soft gate must
 * never be the thing that interrupts: flashing a lock at a subscriber for the first frames of a cold
 * start is the same disappearing-state defect as showing them a paywall, and here the stake is one
 * tap, not the whole screen. Erring open for a moment is the correct direction for a SOFT gate.
 *
 * ## ⚠ The shield OCCLUDES [content]'s own testTags on device
 *
 * While locked, the shield is a full-bleed clickable `Button` with bounds identical to this gate —
 * that is what lets it absorb the tap — and **uiautomator prunes every node underneath it**. So a
 * Maestro/Appium selector addressing anything INSIDE [content] stops resolving the moment a surface
 * is wrapped, on a surface that is rendering perfectly. Nothing on the content side fixes it:
 * `semantics(mergeDescendants = true)` on the wrapped composable does NOT bring the id back.
 *
 * Measured on `mbs/cappy` 2026-10-10 by a controlled dump of one movements screen: the three FREE
 * cards kept their `movements_card_*` ids while the gated cards — visibly on screen, gate tags
 * present — had none.
 *
 * So after wrapping a surface, **retarget its device flows to the gate's own tags**
 * ([PayCraftTestTags.GATE_PLUS_CHIP] / [PayCraftTestTags.GATE_SOFT_SHIELD]). The content's tags stay
 * valid for Compose `commonTest`, whose tree does not prune occluded nodes. Note this cuts the other
 * way too, usefully: an index-free regex selector like `tapOn(id = "movements_card_.*")` can no
 * longer accidentally match a LOCKED row.
 *
 * @param enabled Whether THIS item is Plus-only. `false` disables the gate entirely.
 * @param badge Plus affordance drawn over [content]. `null` uses the SDK's own chip.
 * @param badgeAlignment Where the badge sits within [content]'s bounds.
 * @param lockedContentDescription Accessibility label for the shield — it must say the item needs
 *   Plus, because a sighted user learns that from the chip and a screen-reader user otherwise hears
 *   only the content beneath (NFR-009-shaped concern).
 */
@Composable
fun PayCraftTeaseGate(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    badge: (@Composable () -> Unit)? = null,
    badgeAlignment: Alignment = Alignment.TopEnd,
    lockedContentDescription: String = "Included with Plus — tap to see plans",
    content: @Composable () -> Unit,
) {
    val verdict = rememberGateVerdict()

    // Err OPEN while resolving: see the kdoc. `enabled = false` short-circuits before any SDK read.
    if (!enabled || verdict.entitled || verdict.resolving) {
        Box(modifier = modifier.testTag(PayCraftTestTags.GATE_UNLOCKED)) { content() }
        return
    }

    // The gate OWNS the upsell presentation. It does not merely signal it.
    //
    // `PayCraft.presentPaywall()` only flips `PayCraft.paywallPresentation`, which a host has to
    // observe and render. Most hosts do not: cappy, the first consumer, never reads that flow at all
    // — so a shield that just called it would absorb the tap into NOTHING, which is strictly worse
    // than the chip-plus-navigation it replaces. Rendering the SDK's own sheet here keeps the promise
    // that a consumer wires no paywall, and a sheet is the right shape for an upsell raised from one
    // item in a list (the surface underneath stays visible behind it).
    //
    // presentPaywall() is STILL called, for the analytics/state trigger other SDK surfaces read.
    var showUpsell by remember { mutableStateOf(false) }

    Box(modifier = modifier.testTag(PayCraftTestTags.GATE_SOFT_LOCKED)) {
        content()

        // The shield sits ABOVE content, so it wins the tap. `indication = null` keeps the host's own
        // ripple from double-firing visually on a press that is being redirected.
        Box(
            modifier = Modifier
                .matchParentSize()
                .testTag(PayCraftTestTags.GATE_SOFT_SHIELD)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    PayCraft.presentPaywall()
                    showUpsell = true
                }
                .semantics {
                    role = Role.Button
                    contentDescription = lockedContentDescription
                },
        )

        Box(modifier = Modifier.align(badgeAlignment).padding(8.dp)) {
            if (badge != null) badge() else DefaultPlusChip()
        }

        if (showUpsell) {
            PayCraftPaywallSheet(
                onDismiss = {
                    showUpsell = false
                    PayCraft.dismissPaywall()
                },
            )
        }
    }
}

/**
 * The SDK's own Plus chip — so consumers stop each drawing their own.
 *
 * TRANSLUCENT WHITE, not `tertiaryContainer`. A soft gate most often sits over imagery (a soundscape
 * tile's gradient artwork, a cosmetic's hero render), and a themed container colour can land
 * low-contrast on an arbitrary background — which is exactly why the first consumer overrode this
 * chip rather than using it. White-at-92%-opacity with an elevated shadow reads on artwork AND on a
 * plain surface, so the default is good enough that `badge` stays unused in normal code.
 */
@Composable
private fun DefaultPlusChip() {
    Surface(
        shape = RoundedCornerShape(50),
        color = Color.White.copy(alpha = 0.92f),
        contentColor = Color.Black.copy(alpha = 0.82f),
        shadowElevation = 2.dp,
        modifier = Modifier.testTag(PayCraftTestTags.GATE_PLUS_CHIP),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                modifier = Modifier.size(12.dp),
            )
            Spacer(Modifier.size(4.dp))
            Text(
                text = "Plus",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
            )
        }
    }
}
