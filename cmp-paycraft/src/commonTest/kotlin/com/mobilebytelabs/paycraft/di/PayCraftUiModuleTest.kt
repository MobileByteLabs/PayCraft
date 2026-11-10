package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import org.koin.core.annotation.KoinInternalApi
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * From 3.0 the paywall ViewModel is bound by the UI artifact (`PayCraftUiModule`), because the logic
 * module `cmp-paycraft-core` has no ViewModel types. Apps still only include `payCraft(...)`; the paywall
 * composables register the UI module themselves, exactly once per Koin instance.
 */
@OptIn(KoinInternalApi::class)
class PayCraftUiModuleTest {

    private fun viewModelDefinitions(koin: org.koin.core.Koin): Int = koin.instanceRegistry.instances.values
        .map { it.beanDefinition }
        .distinct()
        .count { it.primaryType == PayCraftPaywallViewModel::class }

    @Test
    fun core_module_no_longer_binds_the_paywall_view_model() {
        val koin = koinApplication { modules(PayCraftModule) }.koin
        assertEquals(0, viewModelDefinitions(koin))
    }

    @Test
    fun ensure_loads_the_ui_module_once() {
        val koin = koinApplication { modules(PayCraftModule) }.koin
        ensurePayCraftUiModule(koin)
        assertEquals(1, viewModelDefinitions(koin))
        ensurePayCraftUiModule(koin)
        assertEquals(1, viewModelDefinitions(koin))
    }
}
