package com.mobilebytelabs.paycraft

import androidx.compose.runtime.staticCompositionLocalOf
import com.mobilebytelabs.paycraft.config.SuiteConfig

/**
 * CompositionLocal carrying the active [SuiteConfig] for the paywall composable tree.
 *
 * Default value is null — composables MUST handle pre-init/failed-fetch defensively
 * (typically by reading [PayCraft.suiteConfig] as a fallback, or rendering a loading
 * shell until init completes). [com.mobilebytelabs.paycraft.ui.PayCraftPaywallComposable]
 * is the canonical reader.
 */
val LocalPayCraftConfig = staticCompositionLocalOf<SuiteConfig?> { null }
