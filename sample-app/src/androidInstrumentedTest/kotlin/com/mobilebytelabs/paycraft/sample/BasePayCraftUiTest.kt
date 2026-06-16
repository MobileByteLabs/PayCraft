package com.mobilebytelabs.paycraft.sample

import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.mobilebytelabs.paycraft.sample.fake.FakePayCraftService
import com.mobilebytelabs.paycraft.sample.fake.FakePayCraftStore
import com.mobilebytelabs.paycraft.sample.fake.testPayCraftModule
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin

abstract class BasePayCraftUiTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    protected val fakeService = FakePayCraftService()
    protected val fakeStore = FakePayCraftStore()

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        // 1. DeviceTokenStore.init MUST be called before anything else
        DeviceTokenStore.init(context)

        // 2. Clear token for clean state
        DeviceTokenStore.clearToken()

        // 3. Reset fake service counters
        fakeService.reset()

        // 4. Initialize PayCraft with Mock backend so PayCraft.requireConfig() returns a
        //    fully-formed PayCraftConfig before Koin starts (PayCraftModule reads it).
        PayCraft.initialize(
            apiKey = "pk_test_ui_test",
            backend = PayCraftBackend.Mock(staticConfig = testSuiteConfig()),
        )

        // 5. Start Koin with test module (AFTER initialize)
        stopKoin()
        startKoin {
            androidContext(context)
            modules(testPayCraftModule(fakeService, fakeStore))
        }
    }

    @After
    fun teardown() {
        DeviceTokenStore.clearToken()
        stopKoin()
    }

    protected fun launchApp() {
        composeTestRule.setContent { App() }
    }

    protected fun assertBillingState(expected: String) {
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("billing_state_label")
                .fetchSemanticsNodes()
                .any { node ->
                    node.config.any { entry -> entry.value == expected }
                }
        }
        composeTestRule.onNodeWithTag("billing_state_label").assertTextEquals(expected)
    }

    protected fun assertTextWithTag(tag: String, expected: String) {
        composeTestRule.onNodeWithTag(tag).assertTextEquals(expected)
    }

    protected fun loginWith(email: String) {
        composeTestRule.onNodeWithTag("input_email").performTextInput(email)
        composeTestRule.onNodeWithTag("btn_login").performClick()
    }

    private fun testSuiteConfig(): SuiteConfig = SuiteConfig(
        tenantId = "test-tenant",
        products = listOf(
            ProductDto(
                id = "monthly",
                sku = "monthly",
                type = "subscription",
                displayName = "Monthly",
                interval = "month",
                basePriceCents = 999,
                baseCurrency = "USD",
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinks = mapOf("monthly" to "https://test.link/monthly"),
            ),
        ),
        paywall = PaywallDto(supportEmail = "test@example.com"),
    )
}
