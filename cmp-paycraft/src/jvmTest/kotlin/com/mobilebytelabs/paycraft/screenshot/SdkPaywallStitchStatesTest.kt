/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * sdk-paywall — one golden per Stitch state (idea-layer/mockups/sdk-paywall/stitch/NN-*), rendered
 * through the SAME frame the shipped surface uses: the circular close top bar, PaywallFrame (one
 * scroll, footer pinned at the bottom) and the real state arm. Each state asserts the tag that
 * defines it BEFORE capture, so a blank or wrong arm fails instead of pinning a broken frame.
 *
 * Rendered under a DARK host scheme so the goldens sit next to the Stitch PNGs for a structural
 * read; every colour still comes from the theme — nothing here or in the SDK hardcodes Stitch's hex.
 *
 *   ./gradlew :cmp-paycraft:recordRoborazziJvm --no-configuration-cache   # (re)generate
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.ConfigResult
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.presentation.PaywallStateHost
import com.mobilebytelabs.paycraft.presentation.ProviderPickerContent
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.PaywallWorkflow
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.presentation.tree.monthlyEquivalentNote
import com.mobilebytelabs.paycraft.presentation.tree.savingsVersusMonthly
import com.mobilebytelabs.paycraft.ui.CheckoutSuccessContent
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.ConfigUnavailable
import com.mobilebytelabs.paycraft.ui.components.PaywallFrame
import com.mobilebytelabs.paycraft.ui.components.PaywallTopBar
import com.mobilebytelabs.paycraft.ui.components.PlansUnavailable
import com.mobilebytelabs.paycraft.ui.components.StaleConfigNotice
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class SdkPaywallStitchStatesTest {

    private fun seed(): PaywallWorkflow = assertNotNull(
        PaywallTreeParser.parse(
            java.io.File("src/commonMain/composeResources/files/paycraft/seed/branded_stack.json").readText(),
        ),
    )

    // Runtime-shaped catalogue: names and prices are DATA, exactly as /config delivers them.
    private val annual = Product.Subscription(
        "p_year",
        "premium_annual",
        "Annual",
        0,
        Product.Subscription.Interval.YEAR,
        Money(3999, "USD"),
    )
    private val monthly = Product.Subscription(
        "p_month",
        "premium_monthly",
        "Monthly",
        1,
        Product.Subscription.Interval.MONTH,
        Money(799, "USD"),
    )
    private val products = listOf(annual, monthly)

    private val config = SuiteConfig(
        tenantId = "stitch-states",
        products = listOf(
            ProductDto(id = "p_year", sku = "premium_annual", type = "subscription", displayName = "Annual"),
            ProductDto(id = "p_month", sku = "premium_monthly", type = "subscription", displayName = "Monthly"),
        ),
        paywall = PaywallDto(termsUrl = "https://example.test/terms", privacyUrl = "https://example.test/privacy"),
    )

    private fun price(role: String, trialDays: Int? = null): PackagePrice {
        val p = if (role == "\$rc_annual") annual else monthly
        return PackagePrice(
            display = p.basePrice.format(),
            perPeriodNote = p.monthlyEquivalentNote(),
            savingsPercent = p.savingsVersusMonthly(products),
            trialDays = trialDays,
            // Production localizes these from the interval (PayCraftPaywallComposable).
            periodLabel = if (p === annual) "\$3.33 / mo" else "/ month",
        )
    }

    /** The phone: dark host scheme, SDK theme, the tenant config the frame reads its footer from. */
    @Composable
    private fun Phone(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = darkColorScheme()) {
            Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                CompositionLocalProvider(LocalPayCraftConfig provides config) {
                    PayCraftThemeProvider(content = content)
                }
            }
        }
    }

    /** What PayCraftPaywallSurface draws: the close top bar over the body. */
    @Composable
    private fun Surface(body: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize()) {
            PaywallTopBar(onClose = {})
            body()
        }
    }

    @Composable
    private fun Host(
        state: BillingState,
        workflow: PaywallWorkflow? = seed(),
        trial: Boolean = false,
        banner: (@Composable () -> Unit)? = null,
    ) {
        PaywallStateHost(
            state = state,
            workflow = workflow,
            context = RenderContext(selectedPackageRole = "\$rc_annual", hasIntroOffer = trial),
            priceFor = { role -> price(role, trialDays = if (trial) 14 else null) },
            onSelectPackage = {},
            onPurchase = {},
            onRestore = {},
            onRetry = {},
            onAction = {},
            enrichFromConfig = false,
            banner = banner,
        )
    }

    /** A modal sheet over the dimmed paywall — the Stitch purchasing / purchase-success composition. */
    @Composable
    private fun SheetOver(sheet: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            Surface { Host(BillingState.Free) }
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)))
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(PayCraftTheme.colors.surface),
            ) { sheet() }
        }
    }

    private fun premium() = BillingState.Premium(
        SubscriptionStatus(isPremium = true, plan = "annual", expiresAt = "2027-11-14T00:00:00Z"),
    )

    @Test
    fun s01_loading() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.Loading) } } }
        onNodeWithTag(PayCraftTestTags.PAYWALL_SHIMMER).assertIsDisplayed()
        capture("01_loading")
    }

    @Test
    fun s02_content() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.Free) } } }
        onNodeWithTag(PayCraftTestTags.PAYWALL_CTA).assertIsDisplayed()
        onNodeWithText("\$39.99").assertIsDisplayed()
        // Card anatomy drawn by the renderer: savings badge + POPULAR on the preselected plan.
        onNodeWithText("SAVE 58%").assertIsDisplayed()
        onNodeWithText("POPULAR").assertIsDisplayed()
        capture("02_content")
    }

    @Test
    fun s03_content_trial() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.Free, trial = true) } } }
        // Both derived from the catalogue's trial at render time, not from the seed.
        onNodeWithTag(PayCraftTestTags.PRODUCT_LIST_TRIAL_TERMS).assertIsDisplayed()
        onNodeWithText("Start 14-day free trial").assertIsDisplayed()
        capture("03_content_trial")
    }

    @Test
    fun s04_purchasing() = runComposeUiTest {
        setContent {
            Phone {
                SheetOver {
                    ProviderPickerContent(
                        providers = listOf(ProviderDto(provider = "stripe"), ProviderDto(provider = "razorpay")),
                        selectedPlan = BillingPlan(
                            id = "p_year",
                            name = "Annual",
                            price = annual.basePrice.format(),
                            interval = "year",
                            rank = 0,
                        ),
                        onProviderPicked = {},
                        onDismiss = {},
                    )
                }
            }
        }
        onNodeWithText("Stripe").assertIsDisplayed()
        capture("04_purchasing")
    }

    @Test
    fun s05_payment_pending() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.PaymentPending("premium_annual")) } } }
        onNodeWithTag(PayCraftTestTags.PAYMENT_PENDING_REASSURANCE).assertIsDisplayed()
        capture("05_payment_pending")
    }

    @Test
    fun s06_purchase_success() = runComposeUiTest {
        setContent {
            Phone {
                SheetOver {
                    val paywall = PaywallDto()
                    CheckoutSuccessContent(
                        title = paywall.successTitle,
                        message = paywall.successMessage,
                        ctaLabel = paywall.successCtaLabel,
                        planName = config.products.first { it.sku == "premium_annual" }.displayName,
                        onCta = {},
                    )
                }
            }
        }
        onNodeWithText("Continue to app").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON).assertDoesNotExist()
        capture("06_purchase_success")
    }

    @Test
    fun s07_premium_active() = runComposeUiTest {
        setContent { Phone { Surface { Host(premium()) } } }
        onNodeWithTag(PayCraftTestTags.PREMIUM_STATUS_CARD).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON).assertIsDisplayed()
        // Manage is the ONLY action for an entitled buyer.
        onNodeWithTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON).assertDoesNotExist()
        capture("07_premium_active")
    }

    @Test
    fun s08_empty_products() = runComposeUiTest {
        setContent {
            Phone {
                Surface {
                    PaywallFrame(background = PayCraftTheme.colors.surface, centerContent = true) {
                        PlansUnavailable(onDismiss = {}, onRestore = {})
                    }
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.NO_PLANS_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.NO_PLANS_DISMISS).assertIsDisplayed()
        capture("08_empty_products")
    }

    @Test
    fun s09_config_error() = runComposeUiTest {
        setContent {
            Phone {
                Surface {
                    PaywallFrame(background = PayCraftTheme.colors.surface, centerContent = true) {
                        ConfigUnavailable(
                            result = ConfigResult.Failed(ConfigResult.Failed.Reason.OFFLINE),
                            onRetry = {},
                            onDismiss = {},
                            onRestore = {},
                        )
                    }
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.OFFLINE_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.CONFIG_FAILED_RETRY).assertIsDisplayed()
        capture("09_config_error")
    }

    @Test
    fun s10_stale_cache() = runComposeUiTest {
        setContent {
            Phone {
                Surface {
                    Host(BillingState.Free, banner = { StaleConfigNotice(ageSeconds = 2L * 3_600L, onRetry = {}) })
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.STALE_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.STALE_REFRESH).assertIsDisplayed()
        capture("10_stale_cache")
    }

    @Test
    fun s11_inline_error() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.Error("network timeout while contacting billing")) } } }
        onNodeWithText("We couldn't reach the store. Check your connection and try again.").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.PAYWALL_CTA).assertIsDisplayed()
        capture("11_inline_error")
    }

    @Test
    fun s12_fatal_error() = runComposeUiTest {
        setContent { Phone { Surface { Host(BillingState.Error("boom"), workflow = null) } } }
        onNodeWithText("Something went wrong").assertIsDisplayed()
        onNodeWithText("Retry").assertIsDisplayed()
        capture("12_fatal_error")
    }

    private fun androidx.compose.ui.test.ComposeUiTest.capture(name: String) {
        val path = "$DIR/sdk_paywall_$name.png"
        onRoot().captureRoboImage(path)
        val f = java.io.File(path)
        assertTrue(f.exists() && f.length() > 0L, "captureRoboImage wrote nothing to $path")
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"
    }
}
