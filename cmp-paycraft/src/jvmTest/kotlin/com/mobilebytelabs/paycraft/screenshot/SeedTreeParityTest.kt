package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeContent
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.presentation.tree.monthlyEquivalentNote
import com.mobilebytelabs.paycraft.presentation.tree.savingsVersusMonthly
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertNotNull

/**
 * D4 PARITY PROBE — the BrandedStack seed tree beside the template it must replace.
 *
 * This captures BOTH renders of the same content so the difference is evidence rather than a claim.
 * D3 deletes the Kotlin templates only once a tree reproduces its golden, and D4 forbids deleting
 * any template before that; this is the measurement that decision depends on.
 *
 * It deliberately does NOT assert pixel equality. The template's plan stack is `ProductList` — a
 * composable carrying the recommended ring, annual-savings badge, trial badge and the dominant CTA.
 * Generic `stack`/`text` nodes cannot re-derive that, which is precisely what D12 anticipated when
 * it said the node leaves must BE BrandedStack's private composables, promoted to public. Asserting
 * equality before that promotion would either fail permanently or force the tree to be shaped around
 * a pixel diff instead of around the design.
 */
@OptIn(ExperimentalTestApi::class)
class SeedTreeParityTest {

    /**
     * The SHIPPED seed, not a copy. A parity probe comparing an inline replica against the template
     * measures the replica; the artifact tenants actually receive is the only thing worth comparing.
     */
    private fun seed(): String = java.io.File(SEED_FILE).readText()

    /**
     * A tree authored BEFORE `{{ product.* }}` variables existed: no price anywhere in its copy.
     * Such a tree must still show prices — via the renderer's corner-overlay fallback — or shipping
     * this change would silently strip the price from every paywall already in production.
     */
    private val legacySeed = """
    {"schema_version":2,"initial_step_id":"paywall","steps":[{"id":"paywall","is_last_step":true,
      "components_config":{"type":"stack","dimension":"vertical","spacing":12,
      "components":[
        {"type":"package","package_id":"${'$'}rc_annual","is_selected_by_default":true,
         "stack":{"type":"stack","dimension":"vertical","spacing":2,
           "padding":{"top":14,"leading":16,"bottom":14,"trailing":16},
           "components":[{"type":"text","text_lid":"annual_name","font_size":16}]}},
        {"type":"purchase_button","text_lid":"cta"}
      ]}}],
     "localizations":{"en_US":{"annual_name":"Annual","cta":"Continue"}}}
    """.trimIndent()

    private fun products() = listOf(
        Product.Subscription("p_year", "sku_year", "Annual", 0, Product.Subscription.Interval.YEAR, Money(4199, "USD")),
        Product.Subscription(
            "p_month",
            "sku_month",
            "Monthly",
            1,
            Product.Subscription.Interval.MONTH,
            Money(699, "USD"),
        ),
    )

    @Composable
    private fun Frame(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                PayCraftThemeProvider(content = content)
            }
        }
    }

    @Test
    fun seed_tree_renders_brandedstack_content() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(seed()))
        setContent {
            Frame {
                PaywallTreeContent(
                    workflow = wf,
                    context = RenderContext(selectedPackageRole = "\$rc_annual"),
                    priceFor = { role ->
                        val p = if (role == "\$rc_annual") products()[0] else products()[1]
                        PackagePrice(
                            display = (p as Product.Subscription).basePrice.format(),
                            perPeriodNote = p.monthlyEquivalentNote(),
                            savingsPercent = p.savingsVersusMonthly(products()),
                        )
                    },
                )
            }
        }
        // The copy the template shows must be the copy the tree shows — the parity that matters for
        // a tenant, independent of pixel geometry.
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        // The shipped seed prices INSIDE each card (a `{{ product.price }}` text node), which is
        // the layout the overlay could not produce — so assert the price, not just the copy.
        onNodeWithText("\$41.99").assertIsDisplayed()
        onNodeWithText("Annual").assertIsDisplayed()
        onNodeWithText("Monthly").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()
        onRoot().captureRoboImage(P_SEED)
    }

    // `template_baseline_for_the_same_content` lived here and rendered BrandedStackTemplate beside
    // the tree. D3 deleted that template, so the comparison has no second subject; the golden it
    // recorded (parity_branded_stack_template.png) stays in the repo as the historical record the
    // deletion was judged against.

    @Test
    fun legacy_tree_without_variables_still_shows_price() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(legacySeed))
        setContent {
            Frame {
                PaywallTreeContent(
                    workflow = wf,
                    context = RenderContext(selectedPackageRole = "\$rc_annual"),
                    priceFor = { PackagePrice(display = "\$41.99") },
                )
            }
        }
        onNodeWithText("Annual").assertIsDisplayed()
        onNodeWithText("\$41.99").assertIsDisplayed()
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"
        const val SEED_FILE = "src/commonMain/composeResources/files/paycraft/seed/branded_stack.json"
        const val P_SEED = "$DIR/parity_branded_stack_tree.png"
    }
}
