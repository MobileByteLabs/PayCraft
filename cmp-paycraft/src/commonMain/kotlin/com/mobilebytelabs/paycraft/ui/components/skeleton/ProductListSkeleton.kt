/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Product-list Loading-branch placeholder — the layout-matched shimmer stand-in
 * for the loaded [com.mobilebytelabs.paycraft.ui.ProductList] surface. Child
 * count and per-item shape mirror the loaded plan-card layout one-to-one so the
 * paywall opens without any visible layout shift when Content composes over the
 * shimmer (AC-6).
 */
package com.mobilebytelabs.paycraft.ui.components.skeleton

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.shimmer.shimmerWave
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Layout-matched placeholder for the loaded [com.mobilebytelabs.paycraft.ui.ProductList]
 * surface. Emits exactly [count] item placeholders — same child count and shape as
 * the loaded product list, so the paywall opens without any visible layout shift when
 * Content composes over the shimmer (AC-6 parity guarantee).
 *
 * Every placeholder animates via [Modifier.shimmerWave] which reads
 * [androidx.compose.material3.MaterialTheme.colorScheme.surfaceVariant] /
 * `surface`, so the shimmer inherits the host theme automatically (no
 * design-system coupling).
 *
 * @param count        Number of placeholder rows — the paywall passes the loaded
 *                     product count so shimmer↔content shape parity holds (AC-6).
 * @param reduceMotion When `true` collapses the shimmer to a static background,
 *                     staying a visible placeholder on OS reduce-motion (AC-14).
 * @param modifier     Layout modifier applied to the root column.
 */
@Composable
fun ProductListSkeleton(count: Int, reduceMotion: Boolean = false, modifier: Modifier = Modifier) {
    val colors = PayCraftTheme.colors
    val cardShape = RoundedCornerShape(16.dp)
    val bar = RoundedCornerShape(6.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.PRODUCT_LIST_SHIMMER)
            .semantics {
                contentDescription = "Loading plans"
                stateDescription = "loading"
            },
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Emit exactly `count` placeholders — shape parity with the loaded plan cards, so a paywall
        // that renders 3 plans on load shows 3 shimmer cards here (never 5-then-3 or a spinner).
        repeat(count) { index ->
            // The first card stands in for the preselected plan: accent ring + the savings pill
            // straddling its top edge, as in the Stitch loading state.
            val selected = index == 0
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
                    .semantics { contentDescription = "Loading plan ${index + 1}" },
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(76.dp)
                        .clip(cardShape)
                        .background(colors.onSurface.copy(alpha = 0.03f))
                        .border(
                            width = if (selected) 1.5.dp else 1.dp,
                            color = if (selected) colors.accent.copy(alpha = 0.45f) else colors.divider,
                            shape = cardShape,
                        )
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Box(Modifier.fillMaxWidth(0.5f).height(16.dp).shimmerWave(bar, reduceMotion = reduceMotion))
                        Spacer(Modifier.height(10.dp))
                        Box(Modifier.fillMaxWidth(0.7f).height(12.dp).shimmerWave(bar, reduceMotion = reduceMotion))
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Box(Modifier.width(64.dp).height(18.dp).shimmerWave(bar, reduceMotion = reduceMotion))
                        Spacer(Modifier.height(10.dp))
                        Box(Modifier.width(44.dp).height(12.dp).shimmerWave(bar, reduceMotion = reduceMotion))
                    }
                }
                if (selected) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = (-16).dp, y = (-10).dp)
                            .width(84.dp)
                            .height(20.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(colors.accent.copy(alpha = 0.22f)),
                    )
                }
            }
        }
    }
}
