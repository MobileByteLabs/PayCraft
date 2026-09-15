package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.presentation.PaywallStateHost
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import kotlin.test.Test
import kotlin.test.assertNotNull

/**
 * The FRAME BOX scrolls, so a tree taller than its viewport still reaches its purchase button.
 *
 * The tree is server-authored, so its height is not knowable at build time — a tenant adds a plan
 * card in the dashboard and the next `/config` fetch renders it on a device nobody tested. Before
 * the scroll container existed, the overflow was simply unreachable, and the first node to fall off
 * the bottom of a paywall is the thing that takes the money.
 *
 * Caught in production: publishing a third plan card to `cappy` pushed `Continue` and
 * `Restore Purchases` past the fold on a real device with no way to scroll to them.
 *
 * The assertion goes through [PaywallStateHost] rather than the tree renderer deliberately — the
 * frame is what owns scrolling, and a test that scrolled a container the tree carried itself would
 * pass while every other billing state stayed stuck.
 *
 * The frame is deliberately SHORT (411x520) against a three-package tree, so the assertions below
 * fail by throwing — `performScrollTo` has no scrollable ancestor to walk — rather than by an
 * invisible-node check that a layout change could quietly satisfy.
 */
@OptIn(ExperimentalTestApi::class)
class PaywallTreeScrollTest {

    private val tallTree = """
    {"schema_version":2,"initial_step_id":"s1","steps":[
      {"id":"s1","name":"Paywall","is_last_step":true,"components_config":{
        "type":"stack","dimension":"vertical","spacing":16,
        "padding":{"top":24,"leading":20,"bottom":24,"trailing":20},
        "components":[
          {"type":"icon","icon_name":"star","size":72},
          {"type":"text","text_lid":"hero","font_size":26,"font_weight_int":700},
          {"type":"text","text_lid":"sub","font_size":14},
          {"type":"package","package_id":"${'$'}rc_annual","is_selected_by_default":true,
           "stack":{"type":"stack","dimension":"vertical","padding":{"top":14,"bottom":14,"leading":16,"trailing":16},
            "components":[{"type":"text","text_lid":"annual"},{"type":"text","text_lid":"annual_note"}]}},
          {"type":"package","package_id":"${'$'}rc_monthly",
           "stack":{"type":"stack","dimension":"vertical","padding":{"top":14,"bottom":14,"leading":16,"trailing":16},
            "components":[{"type":"text","text_lid":"monthly"},{"type":"text","text_lid":"monthly_note"}]}},
          {"type":"package","package_id":"${'$'}rc_custom",
           "stack":{"type":"stack","dimension":"vertical","padding":{"top":14,"bottom":14,"leading":16,"trailing":16},
            "components":[{"type":"text","text_lid":"guardian"},{"type":"text","text_lid":"guardian_note"}]}},
          {"type":"purchase_button","text_lid":"cta"},
          {"type":"restore_purchases","text_lid":"restore"}
        ]}}],
     "localizations":{"en_US":{"hero":"Cappy Plus","sub":"Unlimited check-ins, deeper reflections, and every breathing exercise.",
        "annual":"Annual","annual_note":"Best value","monthly":"Monthly","monthly_note":"Billed monthly",
        "guardian":"Warm Springs Guardian","guardian_note":"Everything in Plus, plus a supporter badge",
        "cta":"Continue","restore":"Restore Purchases"}}}
    """.trimIndent()

    @Test
    fun purchase_button_is_reachable_when_the_tree_overflows_its_viewport() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(tallTree))
        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                Box(
                    Modifier.size(width = 411.dp, height = 520.dp)
                        .background(MaterialTheme.colorScheme.surface),
                ) {
                    PayCraftThemeProvider {
                        PaywallStateHost(
                            state = BillingState.Free,
                            workflow = wf,
                            context = RenderContext(locale = "en_US", selectedPackageRole = "\$rc_annual"),
                            priceFor = { PackagePrice("$41.99") },
                            onSelectPackage = {},
                            onPurchase = {},
                            onRestore = {},
                            onRetry = {},
                            onAction = {},
                            enrichFromConfig = false,
                        )
                    }
                }
            }
        }
        // The hero is above the fold either way — it proves the tree rendered at all, so a failure
        // below is about reach, not about a tree that never parsed.
        onNodeWithText("Cappy Plus").assertIsDisplayed()

        // The third card and both footer actions live past the fold at this height.
        onNodeWithText("Warm Springs Guardian").performScrollTo().assertIsDisplayed()
        onNodeWithText("Continue").performScrollTo().assertIsDisplayed()
        onNodeWithText("RESTORE PURCHASES").performScrollTo().assertIsDisplayed()
    }
}
