package com.mobilebytelabs.paycraft

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AllInclusive
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.NewReleases
import androidx.compose.material.icons.filled.Shield
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_ad_free
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_early_access
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_hd_downloads
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_priority_support
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_unlock_all
import com.mobilebytelabs.paycraft.model.BenefitIcon
import com.mobilebytelabs.paycraft.model.BillingBenefit
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

/**
 * Pre-built [BillingBenefit] instances for common use cases.
 *
 * When you author benefits in your PayCraft dashboard, the cloud-resolved [PaywallDto]
 * is enough — these presets are only useful for local Compose previews or instrumentation
 * tests that need to render a paywall without a network round-trip. Their [BillingBenefit.text]
 * is the English copy; on screen they are shown in the app's language ([localizedText]).
 *
 * Example (Compose preview):
 * ```kotlin
 * @Preview
 * @Composable
 * fun PaywallPreview() {
 *     PayCraftPaywallPreview(benefits = PayCraftBenefits.standard)
 * }
 * ```
 */
object PayCraftBenefits {
    /** "Unlimited downloads with no wait time" — all inclusive icon */
    val unlockAll = BillingBenefit(icon = BenefitIcon.AllInclusive, text = "Unlimited downloads with no wait time")

    /** "Ad-free experience across the entire app" — block icon */
    val adFree = BillingBenefit(icon = BenefitIcon.Block, text = "Ad-free experience across the entire app")

    /** "HD & 4K video downloads" — high quality icon */
    val hdDownloads = BillingBenefit(icon = BenefitIcon.HighQuality, text = "HD & 4K video downloads")

    /** "Priority support & faster processing" — shield icon */
    val prioritySupport = BillingBenefit(icon = BenefitIcon.Shield, text = "Priority support & faster processing")

    /** "Early access to new features" — new releases icon */
    val earlyAccess = BillingBenefit(icon = BenefitIcon.NewReleases, text = "Early access to new features")

    /** Standard 3-benefit preset: unlock all + ad-free + HD downloads */
    val standard = listOf(unlockAll, adFree, hdDownloads)

    /** Full 5-benefit preset */
    val full = listOf(unlockAll, adFree, hdDownloads, prioritySupport, earlyAccess)

    /** The localised resource for each preset (a custom benefit has none and shows its own text). */
    internal val presetText: Map<BillingBenefit, StringResource> = mapOf(
        unlockAll to Res.string.paycraft_benefit_unlock_all,
        adFree to Res.string.paycraft_benefit_ad_free,
        hdDownloads to Res.string.paycraft_benefit_hd_downloads,
        prioritySupport to Res.string.paycraft_benefit_priority_support,
        earlyAccess to Res.string.paycraft_benefit_early_access,
    )
}

/** The Material artwork for a [BenefitIcon] key. */
val BenefitIcon.imageVector: ImageVector
    get() = when (this) {
        BenefitIcon.AllInclusive -> Icons.Filled.AllInclusive
        BenefitIcon.Block -> Icons.Filled.Block
        BenefitIcon.HighQuality -> Icons.Filled.HighQuality
        BenefitIcon.Shield -> Icons.Filled.Shield
        BenefitIcon.NewReleases -> Icons.Filled.NewReleases
        BenefitIcon.Check -> Icons.Filled.Check
    }

/** The text to show: a preset in the app's language, any other benefit exactly as written. */
@Composable
fun BillingBenefit.localizedText(): String = PayCraftBenefits.presetText[this]?.let { stringResource(it) } ?: text
