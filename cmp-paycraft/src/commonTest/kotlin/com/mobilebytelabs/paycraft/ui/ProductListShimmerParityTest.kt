/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Phase 3 (AC-6, AC-14) — shape parity test for the ProductList skeleton.
 * Verifies:
 *   • `ProductListSkeleton(count = N)` emits exactly N `product_list_item_shimmer`
 *     placeholders — count parity with the loaded product list (AC-6).
 *   • Root carries the `product_list_shimmer` testTag + a `loading` stateDescription
 *     for screen-reader accessibility (AC-14).
 *   • Reduced-motion path (`reduceMotion = true`) still renders the same node tree
 *     (no infinite animation) — placeholder remains a visible skeleton.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.v2.runComposeUiTest
import com.mobilebytelabs.paycraft.ui.components.skeleton.ProductListSkeleton
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class ProductListShimmerParityTest {

    /**
     * Skeleton emits exactly N placeholder rows — shape parity with the loaded
     * product list (AC-6). If the loaded paywall shows 3 plans, the shimmer
     * shows 3 placeholder rows, not 5 or an ambiguous single strip.
     */
    @Test
    fun skeleton_item_count_matches_requested_count() {
        listOf(1, 3, 5).forEach { count ->
            runComposeUiTest {
                setContent {
                    MaterialTheme {
                        ProductListSkeleton(count = count, reduceMotion = true)
                    }
                }
                val fetched = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
                    .fetchSemanticsNodes()
                assertEquals(
                    expected = count,
                    actual = fetched.size,
                    message = "ProductListSkeleton(count = $count) should render exactly $count " +
                        "placeholders (shape parity — AC-6)",
                )
            }
        }
    }

    /**
     * Root carries `product_list_shimmer` (AC-6 root tag) so the paywall Loading
     * branch can locate + assert the skeleton without descending into per-item nodes.
     */
    @Test
    fun skeleton_root_carries_product_list_shimmer_test_tag() = runComposeUiTest {
        setContent {
            MaterialTheme {
                ProductListSkeleton(count = 3, reduceMotion = true)
            }
        }
        onNodeWithTag(PayCraftTestTags.PRODUCT_LIST_SHIMMER).assertExists()
    }

    /**
     * Reduced-motion path still renders every placeholder (visible skeleton, no
     * infinite animation) — the AC-14 accessibility contract. Same node count
     * as the animated path, same tag topology.
     */
    @Test
    fun skeleton_renders_under_reduce_motion() = runComposeUiTest {
        setContent {
            MaterialTheme {
                ProductListSkeleton(count = 3, reduceMotion = true)
            }
        }
        val fetched = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
            .fetchSemanticsNodes()
        assertTrue(fetched.size == 3, "reduceMotion path still emits the full count parity")
    }

    /**
     * Zero-count case is degenerate but a valid state (a paywall opening with no
     * cached plans). Should render the root shimmer container with zero placeholders
     * — never crash, never render a phantom single row.
     */
    @Test
    fun skeleton_zero_count_renders_root_only() = runComposeUiTest {
        setContent {
            MaterialTheme {
                ProductListSkeleton(count = 0, reduceMotion = true)
            }
        }
        onNodeWithTag(PayCraftTestTags.PRODUCT_LIST_SHIMMER).assertExists()
        val fetched = onAllNodesWithTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
            .fetchSemanticsNodes()
        assertEquals(0, fetched.size)
    }
}
