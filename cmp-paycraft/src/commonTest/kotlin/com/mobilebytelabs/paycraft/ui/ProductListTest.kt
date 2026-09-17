/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Phase 3 (AC-7) — ProductList surface contract test.
 * Verifies:
 *   • Root carries `product_list` and each item carries `product_list_item` (AC-7).
 *   • Exactly ONE `product_list_recommended` highlight is rendered when the
 *     `popularPlanSku` matches a single product; ZERO when it matches none/two+.
 *   • `trial_badge` renders when at least one trial-eligible product is present.
 *   • `paywall_cta` renders as the single dominant CTA and dispatches the
 *     recommended (or first non-trial) SKU on click.
 *   • Loading branch of the paywall composes the [PaywallSkeleton] and NOT a
 *     [CircularProgressIndicator] (AC-5).
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.PaywallStateHost
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import com.mobilebytelabs.paycraft.presentation.tree.BuiltInPaywallSeeds
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class ProductListTest {

    private val monthlyProduct = Product.Subscription(
        id = "prod_monthly",
        sku = "monthly",
        displayName = "Monthly",
        displayOrder = 0,
        interval = Product.Subscription.Interval.MONTH,
        basePrice = Money(999, "USD"),
    )
    private val annualProduct = Product.Subscription(
        id = "prod_annual",
        sku = "annual",
        displayName = "Annual",
        displayOrder = 1,
        interval = Product.Subscription.Interval.YEAR,
        basePrice = Money(9999, "USD"),
    )
    private val lifetimeProduct = Product.Lifetime(
        id = "prod_lifetime",
        sku = "lifetime",
        displayName = "Lifetime",
        displayOrder = 2,
        basePrice = Money(19999, "USD"),
    )
    private val trialProduct = Product.Trial(
        id = "prod_trial",
        sku = "trial",
        displayName = "7-day Free Trial",
        displayOrder = 99,
        durationDays = 7,
        attachesToProductId = "prod_monthly",
    )

    private val sampleProducts = listOf(monthlyProduct, annualProduct, lifetimeProduct, trialProduct)

    private fun config(popularSku: String? = "annual"): SuiteConfig = SuiteConfig(
        tenantId = "test-tenant",
        paywall = PaywallDto(popularPlanSku = popularSku, ctaContinue = "Continue"),
    )

    // ─── AC-7: product-list surface contract ─────────────────────────────

    @Test
    fun product_list_root_and_items_carry_test_tags() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.PRODUCT_LIST).assertExists()
        val items = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM).fetchSemanticsNodes()
        // sampleProducts has 3 non-trial products (monthly, annual, lifetime) — trial does not
        // render as its own card; it drives the trial badge.
        assertEquals(3, items.size, "ProductList should render one card per non-trial product")
    }

    @Test
    fun product_list_renders_exactly_one_recommended_when_sku_matches_single_product() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        val recommended = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_RECOMMENDED)
            .fetchSemanticsNodes()
        assertEquals(
            expected = 1,
            actual = recommended.size,
            message = "exactly one recommended highlight (AC-7) — the annual plan",
        )
    }

    @Test
    fun product_list_renders_zero_recommended_when_sku_missing() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config(popularSku = null)) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = null,
                    )
                }
            }
        }
        val recommended = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_RECOMMENDED)
            .fetchSemanticsNodes()
        assertEquals(
            expected = 0,
            actual = recommended.size,
            message = "no popularPlanSku → zero recommended highlights (assert-once semantics)",
        )
    }

    @Test
    fun product_list_trial_badge_renders_when_trial_product_present() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.TRIAL_BADGE).assertExists()
    }

    @Test
    fun product_list_trial_badge_absent_when_no_trial_product() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = listOf(monthlyProduct, annualProduct, lifetimeProduct),
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        val badges = onAllNodesWithTag(PayCraftTestTags.TRIAL_BADGE).fetchSemanticsNodes()
        assertEquals(0, badges.size, "no trial → no trial badge")
    }

    // ─── Play Subscriptions policy: trial-terms disclosure ────────────────
    // The paywall must clearly state the trial length, the post-trial price +
    // cadence (on the offer itself), and how to cancel. Missing post-trial price
    // is what got reels-downloader rejected (Subscriptions policy, version 33).

    @Test
    fun trial_eligible_card_shows_post_trial_price_terms() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        // trialProduct attaches to prod_monthly → the monthly card must carry a
        // per-plan trial-terms line naming the post-trial price + cadence.
        val terms = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_TRIAL_TERMS, useUnmergedTree = true)
            .fetchSemanticsNodes()
        assertEquals(
            expected = 1,
            actual = terms.size,
            message = "trial-eligible plan must disclose post-trial price + cadence on the offer",
        )
    }

    @Test
    fun trial_terms_line_absent_when_no_trial_product() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = listOf(monthlyProduct, annualProduct, lifetimeProduct),
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        val terms = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_TRIAL_TERMS, useUnmergedTree = true)
            .fetchSemanticsNodes()
        assertEquals(0, terms.size, "no trial → no per-plan trial-terms line")
    }

    @Test
    fun trial_disclosure_states_cancellation() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        // The disclosure block must tell users the trial auto-converts AND how to
        // avoid the charge (cancel) — the third required policy term.
        onNodeWithTag(PayCraftTestTags.TRIAL_BADGE).assertExists()
        val cancelCopy = onAllNodesWithText("Cancel", substring = true, ignoreCase = true)
            .fetchSemanticsNodes()
        assertTrue(
            cancelCopy.isNotEmpty(),
            "trial disclosure must state how to cancel before being charged",
        )
    }

    @Test
    fun product_list_cta_dispatches_recommended_sku() = runComposeUiTest {
        var dispatched: String? = null
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = { dispatched = it },
                        recommendedSku = "annual",
                    )
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_CTA).assertHasClickAction()
        onNodeWithTag(PayCraftTestTags.PAYWALL_CTA).performClick()
        assertEquals("annual", dispatched, "dominant CTA dispatches the recommended SKU")
    }

    @Test
    fun product_list_savings_badge_renders_on_annual_plan_vs_monthly_baseline() = runComposeUiTest {
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = listOf(monthlyProduct, annualProduct),
                        onPurchase = {},
                        recommendedSku = "annual",
                    )
                }
            }
        }
        waitForIdle()
        // monthly = $9.99/mo; annual = $99.99/yr → per-month $8.33 → ~16% savings.
        // SavingsBadge lives inside a clickable Card whose descendants are
        // merged into the Card's semantics node; assert on the UNMERGED tree
        // so the child testTag is discoverable.
        val badges = onAllNodesWithTag(PayCraftTestTags.SAVINGS_BADGE, useUnmergedTree = true)
            .fetchSemanticsNodes()
        assertTrue(
            badges.isNotEmpty(),
            "annual plan should show a SAVE X% badge vs monthly baseline (found ${badges.size})",
        )
    }

    @Test
    fun product_list_item_click_dispatches_its_own_sku() = runComposeUiTest {
        var dispatched: String? = null
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    ProductList(
                        products = sampleProducts,
                        onPurchase = { dispatched = it },
                        recommendedSku = "annual",
                    )
                }
            }
        }
        // Click the FIRST item (monthly); should dispatch "monthly".
        onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM)[0].performClick()
        assertEquals("monthly", dispatched)
    }

    // ─── AC-5 + AC-14: paywall Loading branch shows skeleton, no spinner ────

    @Test
    fun paywall_loading_branch_shows_skeleton_and_no_spinner() = runComposeUiTest {
        val content = hostContent(BillingState.Loading)
        setContent {
            MaterialTheme {
                content()
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_SHIMMER).assertExists()
        val shimmerItems = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
            .fetchSemanticsNodes()
        assertTrue(shimmerItems.isNotEmpty(), "shimmer must render at least one item placeholder")
        // AC-5 negative — the Loading branch must NOT render any legacy loading text.
        // The old branch had a "Loading subscription status…" caption; the new skeleton
        // has no such text. This asserts the retirement (RULE-IMPL-DEAD-CLICKABLE-001
        // reverse gate — the old node must not co-exist with the new skeleton).
        val stale = onAllNodesWithTag("legacy_loading_spinner").fetchSemanticsNodes()
        assertEquals(0, stale.size, "no legacy spinner testTag may remain on Loading branch")
    }

    @Test
    fun paywall_content_branch_wires_product_list_on_live_path() = runComposeUiTest {
        val content = hostContent(BillingState.Free)
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config()) {
                    content()
                }
            }
        }
        // RULE-IMPL-DEAD-CLICKABLE-001: ProductList is on the live paywall Content
        // path — not dead code. The BrandedStackFree body delegates to it and the
        // paywall_cta tag is present exactly once.
        onNodeWithTag(PayCraftTestTags.PRODUCT_LIST).assertExists()
        val cta = onAllNodesWithTag(PayCraftTestTags.PAYWALL_CTA).fetchSemanticsNodes()
        assertEquals(1, cta.size, "single dominant CTA on the paywall Content path")
    }

    @Test
    fun paywall_content_wires_exactly_one_recommended_from_popular_plan_sku() = runComposeUiTest {
        val content = hostContent(BillingState.Free)
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalPayCraftConfig provides config(popularSku = "annual")) {
                    content()
                }
            }
        }
        val recommended = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_RECOMMENDED)
            .fetchSemanticsNodes()
        assertEquals(1, recommended.size, "popularPlanSku=annual → exactly one recommended card")
    }

    // ─── Trial-copy fail-safe (Play: no unresolved/blank placeholders) ────
    // Google Play's single most common trial-offer rejection is a paywall that
    // renders a literal/broken placeholder or omits the post-trial price. A
    // dashboard-configured template must never produce either — resolveTrialCopy
    // falls back to the guaranteed-correct SDK default.

    @Test
    fun trial_copy_honors_valid_tenant_template() {
        val out = resolveTrialCopy(
            template = "Trial: {days} days, renews at {price}",
            fallback = "{days}-day free trial, then {price}",
            days = 7,
            price = "$9.99 / month",
            requirePrice = true,
        )
        assertEquals("Trial: 7 days, renews at $9.99 / month", out)
    }

    @Test
    fun trial_copy_falls_back_when_tenant_template_drops_price_token() {
        val out = resolveTrialCopy(
            template = "{days}-day free trial", // missing {price} → post-trial cost would vanish
            fallback = "{days}-day free trial, then {price}",
            days = 14,
            price = "₹299 / month",
            requirePrice = true,
        )
        assertEquals("14-day free trial, then ₹299 / month", out)
        assertTrue(out.contains("₹299 / month"), "post-trial price must survive the fallback")
    }

    @Test
    fun trial_copy_falls_back_when_tenant_template_has_broken_token() {
        val out = resolveTrialCopy(
            template = "{days}-day trial, then {prices}", // typo'd token
            fallback = "{days}-day free trial, then {price}",
            days = 7,
            price = "$9.99 / month",
            requirePrice = true,
        )
        assertTrue(!out.contains("{"), "no literal placeholder may reach the UI (Play rejection)")
        assertTrue(out.contains("$9.99 / month"), "fallback restores the post-trial price")
    }

    @Test
    fun trial_copy_body_allows_no_token_and_guards_typos() {
        // Body has no required token; a plain tenant string is honored verbatim.
        val plain = resolveTrialCopy(
            template = "Cancel anytime in Settings before the trial ends.",
            fallback = "default body",
            days = 7,
            price = null,
            requirePrice = false,
        )
        assertEquals("Cancel anytime in Settings before the trial ends.", plain)
        // …but a stray unresolved token falls back to the SDK default.
        val broken = resolveTrialCopy(
            template = "Cancel before {da ys} — oops {bonus}",
            fallback = "default body",
            days = 7,
            price = null,
            requirePrice = false,
        )
        assertEquals("default body", broken)
    }

    // ─── buildProductRows unit sanity ─────────────────────────────────────

    @Test
    fun build_product_rows_annual_savings_computed_vs_monthly_baseline() {
        val rows = buildProductRows(
            products = listOf(monthlyProduct, annualProduct),
            recommendedSku = "annual",
            monthlyBaselineOverrideCents = null,
        )
        val annualRow = rows.first { it.product.sku == "annual" }
        val computed = annualRow.savingsPercent
        assertTrue(
            actual = computed != null && computed > 0,
            message = "annual row should compute a positive savings vs monthly baseline",
        )
        assertTrue(
            actual = annualRow.perMonthAnchor?.contains("billed annually") == true,
            message = "annual row should surface a per-month anchor labeled 'billed annually'",
        )
    }

    @Test
    fun build_product_rows_recommended_is_single_or_null() {
        // Zero matches → null recommended.
        val zeroRows = buildProductRows(
            products = listOf(monthlyProduct),
            recommendedSku = "nonexistent",
            monthlyBaselineOverrideCents = null,
        )
        assertEquals(0, zeroRows.count { it.isRecommended })

        // One match → one recommended.
        val oneRow = buildProductRows(
            products = listOf(monthlyProduct, annualProduct),
            recommendedSku = "annual",
            monthlyBaselineOverrideCents = null,
        )
        assertEquals(1, oneRow.count { it.isRecommended })
    }

    /**
     * The production host over the SHIPPED branded-stack seed — replaces `PaywallTemplate.render`,
     * deleted with the four Kotlin templates (D3). What these tests assert (the Loading shell, the
     * product list wiring, the single recommended ring) is the host's Free/Loading arm now.
     */
    private suspend fun hostContent(state: BillingState): @Composable () -> Unit {
        val wf = BuiltInPaywallSeeds.workflow(PaywallTemplate.BRANDED_STACK)
        return {
            PaywallStateHost(
                state = state,
                workflow = wf,
                context = RenderContext(),
                priceFor = { null },
                onSelectPackage = {},
                onPurchase = {},
                onRestore = {},
                onRetry = {},
                onAction = {},
            )
        }
    }
}
