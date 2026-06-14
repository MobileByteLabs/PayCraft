package com.mobilebytelabs.paycraft

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AllInclusive
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.NewReleases
import androidx.compose.material.icons.filled.Shield
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_ad_free
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_early_access
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_hd_downloads
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_priority_support
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_unlock_all
import com.mobilebytelabs.paycraft.model.BillingBenefit

/**
 * Pre-built [BillingBenefit] instances for common use cases.
 *
 * When you author benefits in your PayCraft dashboard, the cloud-resolved [PaywallDto]
 * is enough — these icons are only useful for local Compose previews or instrumentation
 * tests that need to render a paywall without a network round-trip.
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
    val unlockAll = BillingBenefit(
        icon = Icons.Filled.AllInclusive,
        text = Res.string.paycraft_benefit_unlock_all,
    )

    /** "Ad-free experience across the entire app" — block icon */
    val adFree = BillingBenefit(
        icon = Icons.Filled.Block,
        text = Res.string.paycraft_benefit_ad_free,
    )

    /** "HD & 4K video downloads" — high quality icon */
    val hdDownloads = BillingBenefit(
        icon = Icons.Filled.HighQuality,
        text = Res.string.paycraft_benefit_hd_downloads,
    )

    /** "Priority support & faster processing" — shield icon */
    val prioritySupport = BillingBenefit(
        icon = Icons.Filled.Shield,
        text = Res.string.paycraft_benefit_priority_support,
    )

    /** "Early access to new features" — new releases icon */
    val earlyAccess = BillingBenefit(
        icon = Icons.Filled.NewReleases,
        text = Res.string.paycraft_benefit_early_access,
    )

    /** Standard 3-benefit preset: unlock all + ad-free + HD downloads */
    val standard = listOf(unlockAll, adFree, hdDownloads)

    /** Full 5-benefit preset */
    val full = listOf(unlockAll, adFree, hdDownloads, prioritySupport, earlyAccess)
}
