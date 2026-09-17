package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.presentation.PaywallStateHost
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.ui.LocalPayCraftPaywallFooterActions
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallFooterActions
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Terms and Privacy reach the screen, and reaching them opens the tenant's URLs.
 *
 * `terms_url` / `privacy_url` were served on every `/config` and rendered by nothing: the callbacks
 * existed (`PayCraftPaywallFooterActions`), the templates that once called them were replaced by
 * component trees, and no tree node took over. So the links were configured, present in the payload,
 * and invisible on the device — the failure a payload assertion cannot catch, because the payload
 * was always correct.
 *
 * Clicking is asserted, not just display: a rendered link that is wired to nothing satisfies a
 * store reviewer's screenshot and fails the customer who taps it.
 */
@OptIn(ExperimentalTestApi::class)
class PaywallChromeFooterTest {

    private val tree = """
    {"schema_version":2,"initial_step_id":"s1","steps":[
      {"id":"s1","name":"Paywall","is_last_step":true,"components_config":{
        "type":"stack","dimension":"vertical","spacing":12,
        "components":[
          {"type":"text","text_lid":"hero","font_size":24},
          {"type":"package","package_id":"${'$'}rc_annual","is_selected_by_default":true,
           "stack":{"type":"stack","components":[{"type":"text","text_lid":"annual"}]}},
          {"type":"purchase_button","text_lid":"cta"}
        ]}}],
     "localizations":{"en_US":{"hero":"Cappy Plus","annual":"Annual","cta":"Continue"}}}
    """.trimIndent()

    private fun config(terms: String?, privacy: String?) = SuiteConfig(
        tenantId = "t-cappy",
        paywall = PaywallDto(termsUrl = terms, privacyUrl = privacy),
    )

    @Test
    fun terms_and_privacy_render_and_open_the_tenants_urls() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        var openedTerms = false
        var openedPrivacy = false
        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                    CompositionLocalProvider(
                        LocalPayCraftConfig provides config(
                            terms = "https://example.test/terms",
                            privacy = "https://example.test/privacy",
                        ),
                        LocalPayCraftPaywallFooterActions provides PayCraftPaywallFooterActions(
                            onOpenPrivacy = { openedPrivacy = true },
                            onOpenTerms = { openedTerms = true },
                        ),
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
        }
        onNodeWithText("Terms").performScrollTo().assertIsDisplayed().performClick()
        onNodeWithText("Privacy Policy").performScrollTo().assertIsDisplayed().performClick()
        assertTrue(openedTerms, "tapping Terms must open the tenant's terms_url")
        assertTrue(openedPrivacy, "tapping Privacy Policy must open the tenant's privacy_url")

        // Attribution is frame chrome, so it survives whatever the tree does or does not declare.
        onNodeWithText("Powered by PayCraft by MobileByteSensei").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun a_blank_url_renders_no_link_rather_than_a_dead_one() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                    CompositionLocalProvider(
                        // Blank, not null — the shape a tenant who cleared the field in the dashboard
                        // actually produces, and the one an `!= null` check would wave through.
                        LocalPayCraftConfig provides config(terms = "", privacy = null),
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
        }
        onNodeWithText("Terms").assertDoesNotExist()
        onNodeWithText("Privacy Policy").assertDoesNotExist()
    }
}
