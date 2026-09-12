/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * ProductList — the first-class addressable plans surface for the PayCraft paywall
 * (Phase-3 clean-SDK consolidation, AC-7). Renders every plan inline (annual
 * anchored + savings badge, exactly ONE recommended highlight, trial badge + trial-end
 * microcopy, ONE dominant CTA), so Phase 4's `presentPaywallIfNeeded(entitlement)`
 * auto-present has a real product-list surface to route into rather than a nested
 * PlanSelector buried inside the paywall Content branch.
 *
 * Wired into the single paywall path via [com.mobilebytelabs.paycraft.presentation.templates.BrandedStackTemplate]
 * Free-state rendering — the sole live invocation site keeps this surface on the
 * production path per RULE-IMPL-DEAD-CLICKABLE-001.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.components.EmptyProductsContent
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_disclosure_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_disclosure_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_plan_terms
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags as Tag
import com.mobilebytelabs.paycraft.model.sessionDisplayPrice
import com.mobilebytelabs.paycraft.model.sessionDisplayPriceFormatted

/**
 * First-class addressable plans surface — the paywall's product-list contract
 * shipped in Phase 3 (AC-7). Renders every plan inline with:
 *   - annual anchored + savings badge vs the monthly baseline,
 *   - exactly ONE "recommended" ring (from `popularPlanSku`) — enforced by
 *     the assert-once predicate at composition time so a mis-configured
 *     dashboard row that marks two plans popular fails the semantics
 *     gracefully (no recommended highlight rather than two),
 *   - trial badge + trial-end microcopy when any [Product.Trial] is present,
 *   - one dominant CTA that dispatches [onPurchase] with the recommended (or
 *     first) plan's SKU — [PayCraftTestTags.PAYWALL_CTA].
 *
 * Rendered by [com.mobilebytelabs.paycraft.presentation.templates.BrandedStackTemplate]
 * inside the paywall Free branch — the sole live invocation site (RULE-IMPL-DEAD-CLICKABLE-001).
 *
 * @param products                Sealed [Product] list resolved from the cloud config.
 * @param onPurchase              Called with the picked plan's SKU when the user taps a
 *                                plan card OR the dominant CTA button.
 * @param recommendedSku          The `popularPlanSku` from [PaywallDto] — plan whose SKU
 *                                matches gets the `isRecommended` ring. When null (or the
 *                                match is ambiguous — 0 or 2+ matches) NO plan is highlighted.
 * @param monthlyBaselineCents    Optional per-month price the annual plan compares to when
 *                                computing the savings badge; null → auto-derive from the
 *                                monthly [Product.Subscription] if one exists.
 * @param modifier                Layout modifier applied to the root column.
 */
@Composable
fun ProductList(
    products: List<Product>,
    onPurchase: (String) -> Unit,
    recommendedSku: String? = null,
    monthlyBaselineCents: Int? = null,
    modifier: Modifier = Modifier,
    // Defaulted so every existing caller compiles unchanged; used only by the empty branch to
    // dispatch a retry.
    onAction: (PayCraftPaywallAction) -> Unit = {},
) {
    val paywall = LocalPayCraftConfig.current?.paywall ?: PaywallDto()
    val ctaLabel = paywall.ctaContinue.ifBlank { "Continue" }

    // Derive the display models once per composition — assert-once "recommended"
    // semantics (singleOrNull) guarantees exactly-one recommended plan or none;
    // it is the same predicate the G-3 grep row asserts on.
    val items = remember(products, recommendedSku, monthlyBaselineCents) {
        buildProductRows(
            products = products,
            recommendedSku = recommendedSku,
            monthlyBaselineOverrideCents = monthlyBaselineCents,
        )
    }
    val recommended = items.singleOrNull { it.isRecommended }
    val trialEligibleRow = items.firstOrNull { it.isTrialEligible }

    // An empty product list previously fell through to the normal layout: hero, value props, an
    // empty list, and a DISABLED buy button with no explanation. A disabled control with no
    // adjacent reason is indistinguishable from a broken app, and there was no way to retry.
    //
    // Deliberately checked on `items` (the derived display rows) rather than `products`, so a list
    // that is non-empty but yields no renderable row lands here too instead of rendering a hero
    // above nothing.
    if (items.isEmpty()) {
        EmptyProductsContent(onAction = onAction, modifier = modifier)
        return
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag(Tag.PRODUCT_LIST)
            .semantics { contentDescription = "Available plans" },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Plans stack — every row keyed by SKU. LazyColumn is intentionally NOT used
        // here: the paywall renders a small fixed list (3–5 plans) inside a scrollable
        // parent (BrandedStackFree's verticalScroll), so a nested LazyColumn would
        // fight the parent scroll and requires a fixed height it doesn't have.
        items.forEach { row ->
            ProductListItemRow(
                row = row,
                paywall = paywall,
                onClick = { onPurchase(row.product.sku) },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Trial disclosure — visible when any product in the catalog is trial-eligible
        // (a linked Product.Trial). Names the trial length AND states the auto-renew +
        // how-to-cancel terms (Play Subscriptions policy). Copy is dashboard-driven
        // (PaywallDto.trial* fields) with a localized SDK fallback.
        if (trialEligibleRow != null) {
            TrialEligibilityBadge(row = trialEligibleRow, paywall = paywall)
        }

        Spacer(Modifier.height(4.dp))

        // Single dominant CTA — dispatches the recommended plan's SKU when a
        // recommended plan exists (single winner), else the first non-trial plan.
        val ctaTarget: ProductRow? = recommended
            ?: items.firstOrNull { it.product !is Product.Trial }
            ?: items.firstOrNull()
        Button(
            onClick = { ctaTarget?.let { onPurchase(it.product.sku) } },
            enabled = ctaTarget != null,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag(Tag.PAYWALL_CTA),
            shape = RoundedCornerShape(26.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = PayCraftTheme.colors.accent,
                contentColor = PayCraftTheme.colors.onAccent,
            ),
            contentPadding = PaddingValues(horizontal = 24.dp),
        ) {
            Text(
                text = ctaLabel,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Single product row — the plan card variant used inside [ProductList]. Renders
 * the plan title + secondary price, the annual savings badge when applicable,
 * and the recommended-ring highlight when `row.isRecommended` is true.
 *
 * Extracted so [ProductList] stays a pure composition of rows and Phase 4 can
 * unit-test the row rendering without standing up the whole list.
 */
@Composable
private fun ProductListItemRow(
    row: ProductRow,
    paywall: PaywallDto,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = PayCraftTheme
    val secondary = row.formatSecondary()

    // Root Box wraps the clickable Card so the recommended-ring testTag
    // (PRODUCT_LIST_RECOMMENDED) lives on a NON-clickable outer node —
    // clickable semantics merge descendants and would otherwise swallow the
    // recommended tag off the Card's own testTag slot. This keeps both
    // PRODUCT_LIST_ITEM (on the Card) and PRODUCT_LIST_RECOMMENDED (on the
    // outer Box) discoverable in the merged semantics tree without needing
    // useUnmergedTree in tests.
    val outerModifier = if (row.isRecommended) {
        modifier
            .fillMaxWidth()
            .testTag(Tag.PRODUCT_LIST_RECOMMENDED)
            .semantics { contentDescription = "Recommended plan: ${row.product.displayName}" }
    } else {
        modifier.fillMaxWidth()
    }

    Box(modifier = outerModifier) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .testTag(Tag.PRODUCT_LIST_ITEM),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = if (row.isRecommended) {
                androidx.compose.foundation.BorderStroke(width = 2.dp, color = tokens.colors.accent)
            } else {
                null
            },
            shape = RoundedCornerShape(12.dp),
            onClick = onClick,
        ) {
            Column(
                modifier = Modifier
                    .padding(PaddingValues(horizontal = 16.dp, vertical = 12.dp))
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = row.product.displayName,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (row.savingsPercent != null) {
                        SavingsBadge(percent = row.savingsPercent)
                    }
                }
                Text(
                    text = secondary,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // Annual anchoring — when a per-month equivalent exists (from an
                // annual subscription's cents ÷ 12) surface it under the secondary
                // row so a buyer sees "$99.99 / year" AND "$8.33 / mo billed
                // annually", never one alone.
                row.perMonthAnchor?.let { anchor ->
                    Text(
                        text = anchor,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Medium,
                    )
                }
                // Play Subscriptions-policy disclosure — a trial-eligible plan names
                // the post-trial price + cadence ON the offer itself ("14-day free
                // trial, then ₹299 / month"), so a buyer sees what they'll be charged
                // after the trial, not just that a trial exists. Missing this line is
                // what got reels-downloader (version 33) rejected. Copy is dashboard-
                // driven (paywall.trialTermsTemplate) with a localized SDK fallback.
                if (row.isTrialEligible && row.trialDurationDays != null) {
                    Text(
                        text = resolveTrialCopy(
                            template = paywall.trialTermsTemplate,
                            fallback = stringResource(Res.string.paycraft_trial_plan_terms),
                            days = row.trialDurationDays,
                            price = secondary,
                            requirePrice = true,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = tokens.colors.accent,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag(Tag.PRODUCT_LIST_TRIAL_TERMS),
                    )
                }
            }
        }
    }
}

/**
 * "Save X%" pill badge overlaid at the top-right of the annual plan card. Uses
 * the popular-badge tokens so the color inherits the resolved [PayCraftTheme].
 */
@Composable
private fun SavingsBadge(percent: Int, modifier: Modifier = Modifier) {
    val tokens = PayCraftTheme
    Surface(
        modifier = modifier.testTag(Tag.SAVINGS_BADGE),
        color = tokens.colors.popularBadge,
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            text = "SAVE $percent%",
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelSmall,
            color = tokens.colors.onPopularBadge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * Trial-eligibility disclosure — surfaced above the CTA when any product in the
 * catalog is trial-eligible. Names the trial length AND states the two remaining
 * Play Subscriptions-policy terms: the trial auto-converts to a paid subscription
 * when it ends, and how to cancel before then to avoid the charge. The per-plan
 * price + cadence is disclosed on each plan card ([ProductListItemRow]); this
 * block carries the auto-renew + cancellation terms that apply to whichever plan
 * the buyer taps.
 */
@Composable
private fun TrialEligibilityBadge(row: ProductRow, paywall: PaywallDto, modifier: Modifier = Modifier) {
    val tokens = PayCraftTheme
    val trialDays = row.trialDurationDays ?: 0
    val heading = resolveTrialCopy(
        template = paywall.trialDisclosureTitle,
        fallback = stringResource(Res.string.paycraft_trial_disclosure_title),
        days = trialDays,
        price = null,
        requirePrice = false,
    )
    val subheading = resolveTrialCopy(
        template = paywall.trialDisclosureBody,
        fallback = stringResource(Res.string.paycraft_trial_disclosure_body),
        days = trialDays,
        price = null,
        requirePrice = false,
    )
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(tokens.colors.accent.copy(alpha = 0.10f))
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag(Tag.TRIAL_BADGE)
            .semantics { contentDescription = heading },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(tokens.colors.accent.copy(alpha = 0.18f))
                .padding(6.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = tokens.colors.accent,
                modifier = Modifier.size(14.dp),
            )
        }
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = heading,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = tokens.colors.onSurface,
            )
            Text(
                text = subheading,
                style = MaterialTheme.typography.bodySmall,
                color = tokens.colors.onSurfaceVariant,
            )
        }
    }
}

// ─── Trial-copy token resolution (fail-safe) ─────────────────────────────────

/**
 * Matches any `{token}` placeholder left unresolved after substitution. Google Play
 * rejects paywalls that render literal/broken placeholders (the single most common
 * trial-offer rejection cause), so a malformed tenant template must NEVER reach the UI.
 */
// The closing brace MUST be escaped. A bare `}` is legal on the JVM's regex engine but Android's
// ICU engine rejects it outright (PatternSyntaxException "Syntax error in regexp pattern near
// index 13"). Because this is a top-level val, that throw happens in ProductListKt.<clinit> — the
// class never loads, and EVERY paywall render dies with ExceptionInInitializerError. Device-proven
// on CPH2423 / Android 15, 2026-09-05: reels-downloader crashed on first paywall composition
// (BrandedStackTemplate.kt:140 -> PaywallTemplate.render).
//
// Nothing in this repo's test suite could catch it: all 385 unit tests and every Roborazzi golden
// execute on the JVM, where the unescaped form compiles fine. JVM-green, Android-fatal.
private val UNRESOLVED_TRIAL_TOKEN = Regex("\\{[A-Za-z_]+\\}")

/**
 * Resolve a dashboard-configured trial-copy [template] against the SDK-default [fallback],
 * substituting `{days}` and (optionally) `{price}`. Fail-safe for Play compliance:
 *
 *  - when [requirePrice] is set (the per-plan line), a tenant [template] that DROPS
 *    `{price}` — so the post-trial cost would silently vanish, the exact reels-downloader
 *    rejection — is rejected in favor of [fallback]. `{days}` is optional there because
 *    the disclosure block also states the duration;
 *  - if the chosen string still contains an unresolved `{token}` after substitution
 *    (a tenant typo like `{prices}`), the fully-resolved [fallback] wins;
 *  - the SDK [fallback] always carries the correct tokens, so the returned string is
 *    guaranteed placeholder-free and carries the required post-trial terms.
 */
internal fun resolveTrialCopy(
    template: String,
    fallback: String,
    days: Int,
    price: String?,
    requirePrice: Boolean,
): String {
    fun String.substitute(): String {
        var s = replace("{days}", days.toString())
        if (price != null) s = s.replace("{price}", price)
        return s
    }
    val tenantUsable = template.isNotBlank() && (!requirePrice || template.contains("{price}"))
    val chosen = if (tenantUsable) template else fallback
    val resolved = chosen.substitute()
    return if (UNRESOLVED_TRIAL_TOKEN.containsMatchIn(resolved)) fallback.substitute() else resolved
}

// ─── Internal display-model helpers ──────────────────────────────────────────

/**
 * Per-plan display model — the wrap the [ProductList] renders one card per. Holds
 * the source [Product] plus the derived boolean flags the recommended/savings/
 * trial-badge logic needs so the composable stays a pure render pipeline.
 */
internal data class ProductRow(
    val product: Product,
    val isRecommended: Boolean,
    val isTrialEligible: Boolean,
    val trialDurationDays: Int?,
    val savingsPercent: Int?,
    val perMonthAnchor: String?,
)

/**
 * Format the secondary line (price + billing period) for [row.product]. Matches
 * PlanCard's existing per-variant labels so the loaded row visually parallels the
 * legacy [com.mobilebytelabs.paycraft.presentation.components.PlanCard] rendering.
 */
private fun ProductRow.formatSecondary(): String = when (val p = product) {
    is Product.Subscription -> "${p.sessionDisplayPriceFormatted().orEmpty()} / ${p.interval.readable()}"
    is Product.Lifetime -> "${p.sessionDisplayPriceFormatted().orEmpty()} (one-time)"
    is Product.Trial -> "Free for ${p.durationDays} days"
}

private fun Product.Subscription.Interval.readable(): String = when (this) {
    Product.Subscription.Interval.MONTH -> "month"
    Product.Subscription.Interval.QUARTER -> "quarter"
    Product.Subscription.Interval.SEMIANNUAL -> "6 months"
    Product.Subscription.Interval.YEAR -> "year"
}

/**
 * Build the per-plan display models for [ProductList]. Handles the three
 * derivation concerns the composable would otherwise inline:
 *  - `isRecommended` (assert-once via `singleOrNull { it.sku == recommendedSku }`),
 *  - `isTrialEligible` + `trialDurationDays` (any linked [Product.Trial]),
 *  - `savingsPercent` + `perMonthAnchor` for annual subscriptions (uses either
 *    the passed monthly baseline OR auto-derives it from the monthly subscription
 *    when present).
 */
internal fun buildProductRows(
    products: List<Product>,
    recommendedSku: String?,
    monthlyBaselineOverrideCents: Int?,
): List<ProductRow> {
    // Non-Trial products render as cards; Trial products power the trial badge only.
    val visible = products.filter { it !is Product.Trial }.sortedBy { it.displayOrder }
    val trials = products.filterIsInstance<Product.Trial>()

    // Assert-once: the recommended plan is the ONE match on `sku == recommendedSku`.
    // singleOrNull is deliberate — a mis-configured dashboard row that marks two plans
    // popular fails the semantics (returns null → no ring) rather than showing two.
    val recommendedProduct = visible.singleOrNull { it.sku == recommendedSku }

    // Resolved price, not basePrice: the savings % compares this baseline against each plan's
    // per-month figure, so both sides must come from the SAME currency. Mixing a base-currency
    // baseline with a locale-resolved plan price yields a meaningless percentage.
    val monthlyBaselineMinor: Int? = monthlyBaselineOverrideCents
        ?: visible
            .filterIsInstance<Product.Subscription>()
            .firstOrNull { it.interval == Product.Subscription.Interval.MONTH }
            ?.sessionDisplayPrice()
            ?.amountMinor

    return visible.map { product ->
        val trialLink = trials.firstOrNull { it.attachesToProductId == product.id }
        val savingsPercent = computeSavingsPercent(product, monthlyBaselineMinor)
        val perMonthAnchor = computePerMonthAnchor(product)
        ProductRow(
            product = product,
            isRecommended = recommendedProduct != null && product.id == recommendedProduct.id,
            isTrialEligible = trialLink != null,
            trialDurationDays = trialLink?.durationDays,
            savingsPercent = savingsPercent,
            perMonthAnchor = perMonthAnchor,
        )
    }
}

/**
 * Compute the "SAVE X%" badge percentage for the annual plan (or any subscription
 * whose interval > 1 month). Compares the plan's per-month cost against the
 * [monthlyBaselineCents] baseline (typically the monthly plan's price). Returns
 * null when the plan is not annual/multi-month or when the baseline is absent.
 */
private fun computeSavingsPercent(product: Product, monthlyBaselineMinor: Int?): Int? {
    if (monthlyBaselineMinor == null || monthlyBaselineMinor <= 0) return null
    val sub = product as? Product.Subscription ?: return null
    val monthsInInterval = when (sub.interval) {
        Product.Subscription.Interval.MONTH -> return null // baseline itself
        Product.Subscription.Interval.QUARTER -> 3
        Product.Subscription.Interval.SEMIANNUAL -> 6
        Product.Subscription.Interval.YEAR -> 12
    }
    // Resolved price — must match the currency of monthlyBaselineMinor above.
    val perMonth = (sub.sessionDisplayPrice() ?: sub.basePrice).amountMinor / monthsInInterval
    if (perMonth >= monthlyBaselineMinor) return null
    val saved = monthlyBaselineMinor - perMonth
    return ((saved.toDouble() / monthlyBaselineMinor.toDouble()) * 100.0).toInt().coerceIn(1, 99)
}

/**
 * Compute the "per month billed annually" anchor line for multi-month plans, so
 * an annual plan surfaces both its total ("$99.99 / year") and its effective
 * monthly rate ("$8.33 / mo billed annually"). Returns null for monthly/trial/lifetime.
 */
private fun computePerMonthAnchor(product: Product): String? {
    val sub = product as? Product.Subscription ?: return null
    val months = when (sub.interval) {
        Product.Subscription.Interval.MONTH -> return null
        Product.Subscription.Interval.QUARTER -> 3
        Product.Subscription.Interval.SEMIANNUAL -> 6
        Product.Subscription.Interval.YEAR -> 12
    }
    // Resolved price, not basePrice. On device this line rendered "$8.29 / mo billed annually"
    // directly beneath a "£79.20 / year" headline — the SAME paywall showing two currencies,
    // because the headline went through the resolver and this anchor did not.
    val resolved = sub.sessionDisplayPrice() ?: sub.basePrice
    val perMonthMinor = resolved.amountMinor / months
    val perMonth = Money(perMonthMinor, resolved.currency).format()
    val periodLabel = when (sub.interval) {
        Product.Subscription.Interval.QUARTER -> "billed quarterly"
        Product.Subscription.Interval.SEMIANNUAL -> "billed every 6 months"
        Product.Subscription.Interval.YEAR -> "billed annually"
        Product.Subscription.Interval.MONTH -> ""
    }
    return "$perMonth / mo $periodLabel"
}

/**
 * @suppress reserved for future strike-through original-price anchoring.
 * Currently unused (kept as an import prop for [TextDecoration]) so a future
 * discount-aware anchor render lands without a new import.
 */
@Suppress("unused")
private val strikeThrough = TextDecoration.LineThrough
