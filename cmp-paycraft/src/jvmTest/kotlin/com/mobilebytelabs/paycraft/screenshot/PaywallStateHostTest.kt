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
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.presentation.PaywallStateHost
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.PaywallWorkflow
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The state machine that replaced four templates (D3).
 *
 * `MinimalPremiumBaselineTest` used to hold these arms, one golden per template per state — four
 * copies of the same screen differing in wording no tenant chose. Those subjects are deleted, so the
 * coverage moves here: one host, one golden per ARM, plus the Free arm which the seed goldens
 * already cover per design.
 */
@OptIn(ExperimentalTestApi::class)
class PaywallStateHostTest {

    private fun seed(name: String): PaywallWorkflow = assertNotNull(
        PaywallTreeParser.parse(
            java.io.File("src/commonMain/composeResources/files/paycraft/seed/$name.json").readText(),
        ),
        "$name seed failed to parse",
    )

    private fun premium() = BillingState.Premium(
        SubscriptionStatus(
            isPremium = true,
            plan = "annual",
            email = "user@example.com",
            expiresAt = "2027-04-26T00:00:00Z",
            willRenew = true,
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

    @Composable
    private fun Host(state: BillingState, workflow: PaywallWorkflow?) {
        PaywallStateHost(
            state = state,
            workflow = workflow,
            context = RenderContext(),
            priceFor = { null },
            onSelectPackage = {},
            onPurchase = {},
            onRestore = {},
            onRetry = {},
            onAction = {},
        )
    }

    @Test
    fun premium_arm_render() = runComposeUiTest {
        setContent { Frame { Host(premium(), seed("branded_stack")) } }
        onNodeWithText("You're Premium").assertIsDisplayed()
        onNodeWithText("Plan: annual").assertIsDisplayed()
        onRoot().captureRoboImage(P_PREMIUM)
        assertCaptured(P_PREMIUM)
    }

    // `error_arm_offers_a_retry` lived here and asserted the FULL-SCREEN error with a tree
    // present. That is no longer the contract: with something renderable, a failed purchase is a
    // banner over the plans (see below), and the full-screen path is asserted by
    // `error_with_no_renderable_tree_still_gets_the_full_screen_treatment`.

    /**
     * A purchase failure must not take the paywall down.
     *
     * Found in cappy: its Play catalogue has no products yet, so tapping Continue on the ANNUAL plan
     * replaced the hero, both plans, both prices and the still-buyable MONTHLY plan with a
     * full-screen error and one Retry that fails identically. One unavailable SKU took down the
     * whole paywall.
     */
    @Test
    fun error_arm_keeps_the_plans_on_screen() = runComposeUiTest {
        setContent {
            Frame { Host(BillingState.Error("Product not found on Play: com.x.sub.year"), seed("branded_stack")) }
        }
        // The failure is reported…
        onNodeWithText("This plan isn't available right now. Try another plan, or check back soon.")
            .assertIsDisplayed()
        // …and the paywall is still there to buy from.
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Annual").assertIsDisplayed()
        onNodeWithText("Monthly").assertIsDisplayed()
        onRoot().captureRoboImage(P_ERROR_INLINE)
        assertCaptured(P_ERROR_INLINE)
    }

    @Test
    fun error_with_no_renderable_tree_still_gets_the_full_screen_treatment() = runComposeUiTest {
        // Nothing to fall back to — a banner over a blank sheet would be worse than saying so.
        setContent { Frame { Host(BillingState.Error("boom"), workflow = null) } }
        onNodeWithText("Something went wrong").assertIsDisplayed()
        onNodeWithText("Retry").assertIsDisplayed()
    }

    @Test
    fun loading_arm_renders_the_skeleton() = runComposeUiTest {
        setContent { Frame { Host(BillingState.Loading, seed("branded_stack")) } }
        onRoot().captureRoboImage(P_LOADING)
        assertCaptured(P_LOADING)
    }

    /**
     * A corrupt install — no tenant tree AND no bundled seed — must say so, not render blank.
     * A paywall that renders empty looks like a layout bug and gets dismissed; one that says
     * something is wrong gets retried.
     */
    @Test
    fun free_arm_without_any_tree_shows_an_error_not_a_blank_sheet() = runComposeUiTest {
        setContent { Frame { Host(BillingState.Free, workflow = null) } }
        onNodeWithText("This paywall could not be loaded.").assertIsDisplayed()
        onNodeWithText("Retry").assertIsDisplayed()
    }

    private fun assertCaptured(path: String) {
        val f = java.io.File(path)
        assertTrue(f.exists() && f.length() > 0L, "captureRoboImage wrote nothing to $path")
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"
        const val P_PREMIUM = "$DIR/host_premium.png"
        const val P_LOADING = "$DIR/host_loading.png"
        const val P_ERROR_INLINE = "$DIR/host_error_inline.png"
    }
}
