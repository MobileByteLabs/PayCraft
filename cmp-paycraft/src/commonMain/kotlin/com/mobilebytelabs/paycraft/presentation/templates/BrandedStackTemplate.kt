package com.mobilebytelabs.paycraft.presentation.templates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ValuePropTriple
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.components.PlanCard
import com.mobilebytelabs.paycraft.ui.components.rememberHeroIconOverride
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Production-grade paywall template — the v2 default shipped with cmp-paycraft 2.1.0+.
 *
 * Renders the dashboard's LIVE PREVIEW design exactly: hero icon area, title +
 * subtitle, optional rich-triple value-prop list, polished plan stack with MOST
 * POPULAR ring on `paywall.popular_plan_sku`, branded Continue CTA, terms /
 * privacy / restore micro-footer, and tier-aware "Powered by PayCraft" branding.
 *
 * Every piece of copy + icon comes from [PaywallDto] (v2 — migration 071 fields)
 * read off [LocalPayCraftConfig]; defaults match reels-downloader's existing
 * `strings.xml` premium-banner keys so a tenant that hasn't configured the new
 * fields still renders sensibly.
 *
 * Color + typography read from [PayCraftTheme] so the existing
 * `tenant_paywall.primary_color` / `font_family` / `theme_jsonb` overrides flow
 * through this template just like the legacy ones.
 */
@Composable
fun BrandedStackTemplate(
    state: BillingState,
    products: List<Product>,
    onPickProduct: (Product) -> Unit,
    onRetry: () -> Unit,
) {
    val tokens = PayCraftTheme
    Box(
        Modifier
            .fillMaxSize()
            .background(tokens.colors.surface),
    ) {
        when (state) {
            is BillingState.Loading -> BrandedStackLoading()
            is BillingState.Free -> BrandedStackFree(products, onPickProduct)
            is BillingState.Premium -> BrandedStackPremium(state)
            is BillingState.Error -> BrandedStackError(state.message, onRetry)
            is BillingState.DeviceConflict -> BrandedStackDeviceConflict(state)
            is BillingState.OwnershipVerified -> BrandedStackOwnershipVerified(state)
        }
    }
}

// ─── Free state — the main paywall surface ─────────────────────────────────

@Composable
private fun BrandedStackFree(products: List<Product>, onPickProduct: (Product) -> Unit) {
    val tokens = PayCraftTheme
    val paywall = paywallConfig()
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 20.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PaywallHeroIcon(paywall = paywall)
        Spacer(Modifier.height(4.dp))
        Text(
            text = paywall.heroTitle,
            color = tokens.colors.onSurface,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = paywall.heroSubtitle,
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
        if (paywall.valueProps.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            ValuePropList(items = paywall.valueProps)
        }
        Spacer(Modifier.height(8.dp))
        products
            .sortedBy { it.displayOrder }
            .forEach { product ->
                PlanCard(
                    product = product,
                    onClick = { onPickProduct(product) },
                    popular = product.sku == paywall.popularPlanSku,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        Spacer(Modifier.height(8.dp))
        BrandedStackContinueButton(products, onPickProduct, paywall)
        Spacer(Modifier.height(8.dp))
        PaywallMicroFooter(paywall = paywall)
    }
}

@Composable
private fun BrandedStackContinueButton(
    products: List<Product>,
    onPickProduct: (Product) -> Unit,
    paywall: PaywallDto,
) {
    val tokens = PayCraftTheme
    val defaultProduct = products
        .firstOrNull { it.sku == paywall.popularPlanSku }
        ?: products.firstOrNull()

    Button(
        onClick = { defaultProduct?.let(onPickProduct) },
        enabled = defaultProduct != null,
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp),
        shape = RoundedCornerShape(26.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = tokens.colors.accent,
            contentColor = tokens.colors.onAccent,
        ),
        contentPadding = PaddingValues(horizontal = 24.dp),
    ) {
        Text(
            text = paywall.ctaContinue,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun PaywallMicroFooter(paywall: PaywallDto) {
    val tokens = PayCraftTheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!paywall.privacyUrl.isNullOrBlank()) {
            FooterLink(label = "PRIVACY", onClick = { /* host opens via custom intent */ })
            FooterDot()
        }
        if (!paywall.termsUrl.isNullOrBlank()) {
            FooterLink(label = "TERMS", onClick = { /* host opens via custom intent */ })
            FooterDot()
        }
        FooterLink(
            label = paywall.restoreLabel.uppercase(),
            onClick = { /* host wires onRestoreTap via PayCraftPaywallSheet */ },
        )
    }
    BrandingFooterLine(branding = paywall.branding, customFooter = paywall.customFooter)
}

@Composable
private fun FooterLink(label: String, onClick: () -> Unit) {
    val tokens = PayCraftTheme
    TextButton(onClick = onClick) {
        Text(
            text = label,
            color = tokens.colors.onSurfaceVariant,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun FooterDot() {
    val tokens = PayCraftTheme
    Text(
        text = " · ",
        color = tokens.colors.onSurfaceVariant,
        fontSize = 11.sp,
    )
}

@Composable
private fun BrandingFooterLine(branding: String, customFooter: String?) {
    val tokens = PayCraftTheme
    when (branding) {
        "none" -> Unit
        "custom" -> customFooter?.let {
            Text(
                text = it,
                color = tokens.colors.onSurfaceVariant,
                fontSize = 10.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                textAlign = TextAlign.Center,
            )
        }
        else -> Text(
            text = "Powered by PayCraft by MobileByteSensei",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 10.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            textAlign = TextAlign.Center,
        )
    }
}

// ─── Other billing states ──────────────────────────────────────────────────

@Composable
private fun BrandedStackLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = PayCraftTheme.colors.accent)
            Spacer(Modifier.height(12.dp))
            Text("Loading subscription status…", color = PayCraftTheme.colors.onSurfaceVariant)
        }
    }
}

@Composable
private fun BrandedStackPremium(s: BillingState.Premium) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Filled.Check,
            contentDescription = null,
            tint = tokens.colors.accent,
            modifier = Modifier.size(64.dp),
        )
        Text(
            text = "You're Premium",
            color = tokens.colors.onSurface,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Plan: ${s.status.plan}",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
        )
        s.status.expiresAt?.let {
            Text(
                text = "Renews $it",
                color = tokens.colors.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
        s.trial?.let {
            Text(
                text = "Trial: ${it.daysRemaining} days remaining",
                color = tokens.colors.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun BrandedStackError(msg: String, onRetry: () -> Unit) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Something went wrong",
            color = tokens.colors.onSurface,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(text = msg, color = tokens.colors.onSurfaceVariant, fontSize = 14.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(
                containerColor = tokens.colors.accent,
                contentColor = tokens.colors.onAccent,
            ),
            shape = RoundedCornerShape(26.dp),
        ) { Text("Retry") }
    }
}

@Composable
private fun BrandedStackDeviceConflict(s: BillingState.DeviceConflict) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Device limit reached",
            color = tokens.colors.onSurface,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Your account is active on another device. Sign in there or contact support.",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
        )
    }
}

@Composable
private fun BrandedStackOwnershipVerified(s: BillingState.OwnershipVerified) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Filled.Check,
            contentDescription = null,
            tint = tokens.colors.accent,
            modifier = Modifier.size(48.dp),
        )
        Text(
            text = "Verified",
            color = tokens.colors.onSurface,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Your subscription is now active on this device.",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
    }
}

// ─── Hero icon + value-prop list — extracted so PayCraftPremiumBanner can reuse ─────

@Composable
internal fun PaywallHeroIcon(paywall: PaywallDto) {
    val tokens = PayCraftTheme
    val tile = Modifier
        .size(72.dp)
        .clip(RoundedCornerShape(20.dp))
        .background(tokens.colors.accent.copy(alpha = 0.12f))
    Box(modifier = tile, contentAlignment = Alignment.Center) {
        // Dashboard branding-icon override: a tenant's inline SVG path (hero_icon_svg) is
        // parsed via the multiplatform PathParser (rememberHeroIconOverride) — no per-platform
        // SVG engine needed — and falls back to the SDK default brand-tinted Star when unset.
        val heroIcon = rememberHeroIconOverride(paywall.heroIconSvg) ?: Icons.Filled.Star
        Icon(
            imageVector = heroIcon,
            contentDescription = null,
            tint = tokens.colors.accent,
            modifier = Modifier.size(40.dp),
        )
    }
}

@Composable
internal fun ValuePropList(items: List<ValuePropTriple>) {
    val tokens = PayCraftTheme
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items.forEach { item ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(tokens.colors.accent.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = tokens.colors.accent,
                        modifier = Modifier.size(16.dp),
                    )
                }
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = item.title,
                        color = tokens.colors.onSurface,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    item.description?.takeIf { it.isNotBlank() }?.let { desc ->
                        Spacer(Modifier.width(2.dp))
                        Text(
                            text = desc,
                            color = tokens.colors.onSurfaceVariant,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}

// ─── Helper — read PaywallDto off LocalPayCraftConfig with sane fallback ────

@Composable
internal fun paywallConfig(): PaywallDto = LocalPayCraftConfig.current?.paywall ?: PaywallDto()
