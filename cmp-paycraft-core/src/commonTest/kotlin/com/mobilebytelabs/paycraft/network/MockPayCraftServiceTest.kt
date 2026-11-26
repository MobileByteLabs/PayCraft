package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * [PayCraftBackend.Mock] is "in-process — for tests and offline previews", but PayCraftModule bound the
 * Supabase-backed service regardless. Mock's `mock://` URL became https://localhost, so a sample app on Mock showed
 * "register_device … Connection refused" the moment anyone logged in. Mock now gets a service that never leaves
 * the process.
 */
class MockPayCraftServiceTest {

    private class Store : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
    }

    @BeforeTest
    fun clean() = DeviceTokenStore.clearToken()

    @AfterTest
    fun tearDown() {
        DeviceTokenStore.clearToken()
        runCatching { stopKoin() }
    }

    @Test
    fun a_registered_device_token_is_valid_and_bound_to_its_email() = runTest {
        val service = MockPayCraftService()
        val reg = service.registerDevice("buyer@example.com", "android", "Pixel", "device-1")

        assertFalse(reg.conflict)
        val check = service.checkPremiumWithDevice(reg.deviceToken)
        assertTrue(check.tokenValid)
        assertFalse(check.isPremium, "a mock buyer is Free until a store purchase says otherwise")
        assertTrue(check.isBoundTo("buyer@example.com"))
    }

    @Test
    fun a_token_it_never_issued_is_invalid() = runTest {
        assertFalse(MockPayCraftService().checkPremiumWithDevice("srv_from_a_real_backend").tokenValid)
    }

    @Test
    fun another_email_on_the_same_device_gets_its_own_token() = runTest {
        val service = MockPayCraftService()
        val a = service.registerDevice("a@example.com", "android", "Pixel", "device-1")
        val b = service.registerDevice("b@example.com", "android", "Pixel", "device-1")
        assertNotEquals(a.deviceToken, b.deviceToken)
        assertTrue(service.checkPremiumWithDevice(b.deviceToken).isBoundTo("b@example.com"))
    }

    @Test
    fun logging_in_on_mock_ends_free_not_in_an_error() = runTest {
        val manager =
            PayCraftBillingManager(
                service = MockPayCraftService(),
                store = Store(),
                dispatcher = StandardTestDispatcher(testScheduler),
            )
        advanceUntilIdle()

        manager.logIn("buyer@example.com")
        advanceUntilIdle()

        assertIs<BillingState.Free>(manager.billingState.value)
    }

    @Test
    fun the_module_binds_the_in_process_service_for_mock() {
        PayCraft.initialize(apiKey = "pk_test_mock", backend = PayCraftBackend.Mock(SuiteConfig(tenantId = "t")))
        val koin = startKoin { modules(PayCraftModule) }.koin
        assertIs<MockPayCraftService>(koin.get<PayCraftService>())
        assertEquals("mock", PayCraft.backend.supabaseAnonKey)
    }
}
