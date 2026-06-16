package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.ProductMapper
import com.mobilebytelabs.paycraft.presentation.PayCraftThemeProvider
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import org.koin.compose.viewmodel.koinViewModel

/**
 * v2 cloud-driven paywall surface.
 *
 * Reads tenant config from [LocalPayCraftConfig] (falling back to [PayCraft.suiteConfig]
 * for callers that haven't wrapped with a CompositionLocalProvider), resolves the
 * [PaywallTemplate] enum from `paywall.template`, maps cloud [com.mobilebytelabs.paycraft.config.ProductDto]
 * into the SDK sealed [Product] hierarchy, wraps in [PayCraftThemeProvider] so cloud
 * `theme_jsonb` overrides take effect, then dispatches to the template's `render()`.
 *
 * Product picks bridge to the existing v1 [PayCraftPaywallAction.SelectPlan] flow via
 * [Product.toBillingPlan] until sub-plan 05's provider-picker work adds a v2-native
 * SelectProduct action.
 */
@Composable
fun PayCraftPaywallComposable() {
    val vm: PayCraftPaywallViewModel = koinViewModel()
    val config = LocalPayCraftConfig.current ?: PayCraft.suiteConfig ?: return
    val state by vm.state.collectAsState()
    val template = PaywallTemplate.parse(config.paywall.template)
    val products: List<Product> = config.products
        .filter { it.active }
        .map(ProductMapper::fromDto)
        .sortedBy { it.displayOrder }

    PayCraftThemeProvider(themeOverride = config.paywall.themeJsonb) {
        template.render(
            state = state.billingState,
            products = products,
            onPickProduct = { product ->
                vm.dispatch(PayCraftPaywallAction.SelectPlan(product.toBillingPlan(config)))
            },
            onRetry = { vm.dispatch(PayCraftPaywallAction.RefreshStatus) },
        )
    }
}

/** Bridge a v2 [Product] to the v1 [BillingPlan] sealed-interface flow used by the existing viewmodel. */
private fun Product.toBillingPlan(config: SuiteConfig): BillingPlan {
    val dtoMatch = config.products.firstOrNull { it.id == this.id }
    val priced = dtoMatch?.resolvedPrice
    val priceLabel = when {
        priced != null -> Money(priced.amountCents, priced.currency).format()
        this is Product.Subscription -> basePrice.format()
        this is Product.Lifetime -> basePrice.format()
        this is Product.Trial -> "Free"
        else -> ""
    }
    val intervalLabel = when (this) {
        is Product.Subscription -> when (interval) {
            Product.Subscription.Interval.MONTH -> "month"
            Product.Subscription.Interval.QUARTER -> "quarter"
            Product.Subscription.Interval.SEMIANNUAL -> "6mo"
            Product.Subscription.Interval.YEAR -> "year"
        }
        is Product.Trial -> "trial"
        is Product.Lifetime -> "lifetime"
    }
    val trialDays = (this as? Product.Trial)?.durationDays
    return BillingPlan(
        id = id,
        name = displayName,
        price = priceLabel,
        interval = intervalLabel,
        rank = displayOrder,
        trialDays = trialDays,
    )
}
