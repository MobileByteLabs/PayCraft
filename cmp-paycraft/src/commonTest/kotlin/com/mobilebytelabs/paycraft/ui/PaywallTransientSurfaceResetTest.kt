package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.koin.compose.KoinApplication
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Reported on device 2026-10-31: open the paywall → tap Restore → close → open the paywall again,
 * and it opens straight onto the restore screen, every time after.
 *
 * The paywall's ViewModel is resolved from the HOST's ViewModelStoreOwner, so it outlives the sheet.
 * In Sheet mode the restore surface replaces the paywall body in the same window; closing that window
 * (swipe, back, the X) never dispatched CloseRestoreSheet, so `isRestoreSheetVisible` stayed true.
 */
@OptIn(ExperimentalTestApi::class)
class PaywallTransientSurfaceResetTest {

    @BeforeTest
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun closing_the_paywall_while_restore_is_showing_reopens_on_the_paywall() = runComposeUiTest {
        var paywallShown by mutableStateOf(true)
        lateinit var vm: PayCraftPaywallViewModel

        setContent {
            KoinApplication(application = {
                modules(
                    module {
                        single<BillingManager> { FakeBillingManager(premium = false) }
                        viewModelOf(::PayCraftPaywallViewModel)
                    },
                )
            }) {
                vm = koinViewModel() // the host-owned instance the paywall resolves too
                if (paywallShown) {
                    PayCraftPaywallComposable(surfaceMode = PayCraftSurfaceMode.Sheet)
                }
            }
        }

        vm.dispatch(PayCraftPaywallAction.OpenRestoreSheet)
        waitForIdle()
        assertTrue(vm.state.value.isRestoreSheetVisible, "precondition: restore is showing")

        paywallShown = false // the user closes the sheet without going "back" from restore
        waitForIdle()
        paywallShown = true
        waitForIdle()

        assertFalse(vm.state.value.isRestoreSheetVisible, "a reopened paywall must show the paywall, not restore")
    }
}
