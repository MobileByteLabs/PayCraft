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
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The last link in the chain: a tree the DASHBOARD EDITOR produced, rendered by the SDK.
 *
 * The fixture is not hand-written. It is the literal output of `tree-edit`'s operations — patch,
 * insert, move, remove, plus copy edits in two locales — captured from the dashboard's own edit
 * layer, then pushed through `tenant_paywall_workflow_upsert` and `tenant_paywall_publish` against
 * a real Postgres. So this test answers the only question that matters once all three pieces exist
 * separately: does what the editor writes actually draw on a device?
 *
 * It also pins the property that made raw-JSON editing the right choice — the fixture still carries
 * `node_position`, a field NEITHER renderer models. If the editor had round-tripped through its
 * parsed model, that field would have been silently deleted before it ever reached here.
 */
@OptIn(ExperimentalTestApi::class)
class DashboardEditedTreeTest {

    private val fixture = "src/jvmTest/resources/fixtures/dashboard_edited_workflow.json"

    // The edit sequence DELETED the annual plan (removeNode shifted the indices), so monthly is
    // what survived. Asserted against the fixture rather than against what the edits were meant to
    // do — a test that agrees with the intention instead of the artifact proves nothing.
    private val monthly = Product.Subscription(
        "p_month",
        "sku_month",
        "Monthly",
        1,
        Product.Subscription.Interval.MONTH,
        Money(699, "USD"),
    )

    @Test
    fun a_tree_the_dashboard_edited_renders_in_the_sdk() = runComposeUiTest {
        val json = java.io.File(fixture).readText()
        assertTrue(json.contains("node_position"), "fixture lost the unmodelled field it exists to prove")

        val wf = assertNotNull(PaywallTreeParser.parse(json), "the SDK could not parse the editor's output")
        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                    PayCraftThemeProvider {
                        PaywallTreeContent(
                            workflow = wf,
                            context = RenderContext(selectedPackageRole = "${'$'}rc_monthly"),
                            priceFor = { role ->
                                if (role != "${'$'}rc_monthly") {
                                    null
                                } else {
                                    PackagePrice(
                                        display = monthly.basePrice.format(),
                                        perPeriodNote = monthly.monthlyEquivalentNote(),
                                        savingsPercent = null,
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }

        // The edits are visible, not merely parsed: the copy typed into the editor renders, and so
        // does the plan card it was added beside.
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Cancel anytime").assertIsDisplayed()
        onNodeWithText("Monthly").assertIsDisplayed()
        onNodeWithText("${'$'}6.99").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()

        onRoot().captureRoboImage("src/jvmTest/resources/screenshots/dashboard_edited_tree.png")
        assertTrue(
            java.io.File("src/jvmTest/resources/screenshots/dashboard_edited_tree.png").length() > 0,
            "captureRoboImage wrote nothing",
        )
    }
}
