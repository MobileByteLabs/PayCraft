package com.mobilebytelabs.paycraft.presentation

/**
 * Strategy for how the user picks a payment provider after selecting a plan.
 *
 * - [AutoSkipWhenSingle] (default): if only 1 locale-eligible provider is configured,
 *   skip the sheet and proceed to checkout directly; otherwise show the sheet.
 * - [BottomSheet]: always show the sheet, even when only 1 provider is available.
 * - [Inline]: render provider chips inside the plan card (no sheet). Declared for v2.0.x.
 */
sealed interface ProviderPicker {
    data object AutoSkipWhenSingle : ProviderPicker
    data class BottomSheet(val maxVisible: Int = 4) : ProviderPicker
    data object Inline : ProviderPicker
}
