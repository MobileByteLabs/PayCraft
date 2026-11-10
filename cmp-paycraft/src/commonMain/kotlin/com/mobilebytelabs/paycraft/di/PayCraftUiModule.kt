package com.mobilebytelabs.paycraft.di

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import org.koin.compose.getKoin
import org.koin.core.Koin
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module

/**
 * The paywall's ViewModel binding. It lives in the UI artifact because the logic module
 * (`cmp-paycraft-core`, which owns [PayCraftModule] and `payCraft(...)`) has no ViewModel types.
 *
 * Apps never include this themselves: the paywall composables register it on first use
 * ([rememberPayCraftUiModule]), so a host that only calls `payCraft(...)` keeps working unchanged.
 */
val PayCraftUiModule = module { viewModelOf(::PayCraftPaywallViewModel) }

private const val UI_MODULE_LOADED = "paycraft.ui.module.loaded"

/** Loads [PayCraftUiModule] into [koin] once; later calls are no-ops. */
internal fun ensurePayCraftUiModule(koin: Koin) {
    if (koin.getProperty<Boolean>(UI_MODULE_LOADED) == true) return
    koin.loadModules(listOf(PayCraftUiModule))
    koin.setProperty(UI_MODULE_LOADED, true)
}

/** Registers [PayCraftUiModule] in the current Koin before a paywall resolves its ViewModel. */
@Composable
internal fun rememberPayCraftUiModule() {
    val koin = getKoin()
    remember(koin) { ensurePayCraftUiModule(koin) }
}
