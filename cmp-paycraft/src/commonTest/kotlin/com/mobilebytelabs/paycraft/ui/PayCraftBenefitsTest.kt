package com.mobilebytelabs.paycraft.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AllInclusive
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.NewReleases
import androidx.compose.material.icons.filled.Shield
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.PayCraftBenefits
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_ad_free
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_early_access
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_hd_downloads
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_priority_support
import com.mobilebytelabs.paycraft.generated.resources.paycraft_benefit_unlock_all
import com.mobilebytelabs.paycraft.imageVector
import com.mobilebytelabs.paycraft.model.BenefitIcon
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.ui.components.BenefitItem
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `BillingBenefit` is Compose-free from 3.0 (an icon key + plain text) so it can live in
 * `cmp-paycraft-core`; the UI module owns the icon artwork and the localised preset strings.
 * These tests pin that mapping so the split changes nothing a user sees.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftBenefitsTest {

    @Test
    fun every_benefit_icon_maps_to_its_material_vector() {
        assertEquals(Icons.Filled.AllInclusive, BenefitIcon.AllInclusive.imageVector)
        assertEquals(Icons.Filled.Block, BenefitIcon.Block.imageVector)
        assertEquals(Icons.Filled.HighQuality, BenefitIcon.HighQuality.imageVector)
        assertEquals(Icons.Filled.Shield, BenefitIcon.Shield.imageVector)
        assertEquals(Icons.Filled.NewReleases, BenefitIcon.NewReleases.imageVector)
        assertEquals(Icons.Filled.Check, BenefitIcon.Check.imageVector)
    }

    @Test
    fun full_preset_keeps_its_icons_and_order() {
        assertEquals(
            listOf(
                BenefitIcon.AllInclusive,
                BenefitIcon.Block,
                BenefitIcon.HighQuality,
                BenefitIcon.Shield,
                BenefitIcon.NewReleases,
            ),
            PayCraftBenefits.full.map { it.icon },
        )
        assertEquals(PayCraftBenefits.full.take(3), PayCraftBenefits.standard)
    }

    @Test
    fun every_preset_is_localised_through_its_string_resource() {
        // Only English resources exist, where the preset text equals the resource string — so the render
        // test below cannot tell "localised" from "fell back to text". This pins the mapping itself.
        assertEquals(
            mapOf(
                PayCraftBenefits.unlockAll to Res.string.paycraft_benefit_unlock_all,
                PayCraftBenefits.adFree to Res.string.paycraft_benefit_ad_free,
                PayCraftBenefits.hdDownloads to Res.string.paycraft_benefit_hd_downloads,
                PayCraftBenefits.prioritySupport to Res.string.paycraft_benefit_priority_support,
                PayCraftBenefits.earlyAccess to Res.string.paycraft_benefit_early_access,
            ),
            PayCraftBenefits.presetText,
        )
    }

    @Test
    fun preset_renders_the_localised_resource_string() = runComposeUiTest {
        setContent { BenefitItem(benefit = PayCraftBenefits.adFree, index = 0) }
        onNodeWithText("Ad-free experience across the entire app").assertExists()
    }

    @Test
    fun custom_benefit_renders_its_own_text() = runComposeUiTest {
        setContent { BenefitItem(benefit = BillingBenefit(BenefitIcon.Check, "Custom perk"), index = 0) }
        onNodeWithText("Custom perk").assertExists()
    }
}
