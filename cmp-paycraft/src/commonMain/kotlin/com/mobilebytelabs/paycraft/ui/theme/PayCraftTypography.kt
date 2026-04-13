package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * PayCraft typography scale.
 *
 * Delegates to Material3 [Typography] by default so that PayCraft UI inherits the
 * host app's type scale automatically. Override specific styles if you want to
 * customise PayCraft text without changing the app-wide theme.
 *
 * @param base Host app's [Typography] used as the fallback for all unset styles.
 * @param paywall Title shown at the top of the full-screen paywall.
 * @param planPrice Price text inside each plan card.
 * @param planName Plan name underneath the price.
 * @param planInterval Billing interval label (e.g. "per month").
 * @param benefitText Text alongside each benefit row icon.
 * @param activeBadge Uppercase label inside the ACTIVE badge pill.
 * @param statusLabel Left-hand label in the premium status card rows.
 * @param statusValue Right-hand value in the premium status card rows.
 * @param supportLink Small disclaimer / support link text.
 */
data class PayCraftTypography(
    val base: Typography = Typography(),
    val paywall: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
    ),
    val planPrice: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.sp,
    ),
    val planName: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    val planInterval: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
    val benefitText: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
    ),
    val activeBadge: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        letterSpacing = 1.5.sp,
    ),
    val statusLabel: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
    ),
    val statusValue: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
    ),
    val supportLink: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
) {
    companion object {
        /** Default typography that mirrors Material3's body/title scale. */
        val Default = PayCraftTypography()
    }
}
