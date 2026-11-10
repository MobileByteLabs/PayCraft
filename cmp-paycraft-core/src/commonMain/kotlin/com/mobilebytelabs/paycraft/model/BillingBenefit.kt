package com.mobilebytelabs.paycraft.model

/**
 * The artwork a [BillingBenefit] shows. A key, not an image: the logic layer (`cmp-paycraft-core`) has no
 * Compose, so the UI module maps each key to its Material vector (`BenefitIcon.imageVector`).
 */
enum class BenefitIcon { AllInclusive, Block, HighQuality, Shield, NewReleases, Check }

/**
 * One line in the paywall's benefit list: an [icon] key and the [text] to show. The built-in presets in
 * `PayCraftBenefits` are localised by the UI module; custom benefits render [text] as given.
 *
 * 3.0: was `BillingBenefit(icon: ImageVector, text: StringResource)` — see MIGRATION_3.0.md.
 */
data class BillingBenefit(val icon: BenefitIcon, val text: String)
