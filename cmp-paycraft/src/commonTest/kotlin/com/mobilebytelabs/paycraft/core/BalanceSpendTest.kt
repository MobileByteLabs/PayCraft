package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Consumable balances on [PayCraftBillingManager] — the layer that turns a bought coin pack into a
 * spendable balance (REQUIREMENTS.md PC-001..006, API_CONTRACTS.md AR-011..AR-013).
 *
 * ## Why these assertions and not "the number went up"
 *
 * The balance is the one piece of SDK state a user pays real money for, so the invariants that
 * matter are about what must NEVER happen:
 *
 *  - **AR-013, no local write path.** Every published value must come from a server answer. A test
 *    that only checks "balance decreased after spend" passes just as happily against a local
 *    decrement, which is forgeable currency. So the fake returns a value the client could not have
 *    computed (a deliberate mismatch) and the test asserts the SERVER's number wins.
 *  - **AR-012, insufficient funds is not an exception.** A shopper short on coins is an ordinary
 *    outcome; the host renders a message, not a crash.
 *  - **A rejected spend must not move the balance.** Treating a failure as a debit — or worse, as
 *    a success — is the outcome that hands over goods nobody paid for.
 *  - **AR-011, the caller's idempotency key reaches the wire verbatim.** The key exists so a retry
 *    after a timeout replays instead of charging twice; a manager that regenerated or dropped it
 *    would silently reintroduce the double-charge it prevents.
 *
 * The subject is deliberately NOT a parameter anywhere here: migration 159 made the server derive
 * it from the device token, which is why these calls take a token and why they could not be made
 * honestly before (the client has no way to learn its own subject id).
 */
class BalanceSpendTest {

    private companion object {
        const val SKU = "cappy_ripples_550"
        const val TOKEN = "device-token-abc"
    }

    /** Records what reached the wire and returns scripted answers. */
    private class FakeBalanceService(
        private val balance: Int = 0,
        /** What `spendBalance` returns; null models BOTH insufficient funds and transport failure. */
        private val spendResult: Int? = null,
    ) : PayCraftService {
        var balanceOfToken: String? = null
        var spendToken: String? = null
        var spendIdempotencyKey: String? = null
        var spendQuantity: Int? = null
        var spendCallCount = 0

        override suspend fun isPremium(serverToken: String): Boolean = false
        override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
        override suspend fun isTrialEligible(serverToken: String): Boolean = false
        override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult =
            PremiumCheckResult(isPremium = false, tokenValid = true)
        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = false
        override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean = false
        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
        override suspend fun registerDevice(
            email: String,
            platform: String,
            deviceName: String,
            deviceId: String,
            mode: String,
        ): RegisterDeviceResult = RegisterDeviceResult(TOKEN, false, null, null)

        override suspend fun balanceOf(serverToken: String, sku: String): Int {
            balanceOfToken = serverToken
            return balance
        }

        override suspend fun spendBalance(
            serverToken: String,
            sku: String,
            quantity: Int,
            idempotencyKey: String,
        ): Int? {
            spendCallCount++
            spendToken = serverToken
            spendQuantity = quantity
            spendIdempotencyKey = idempotencyKey
            return spendResult
        }
    }

    /** Everything else on PayCraftStore has an interface default; only these three are abstract. */
    private class NoCacheStore : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
    }

    private fun manager(service: PayCraftService) = PayCraftBillingManager(service = service, store = NoCacheStore())

    @BeforeTest
    fun seedDevice() = DeviceTokenStore.saveToken(TOKEN)

    @AfterTest
    fun clearDevice() = DeviceTokenStore.clearToken()

    @Test
    fun refreshBalance_publishes_the_server_value_and_sends_the_device_token() = runTest {
        val service = FakeBalanceService(balance = 550)
        val m = manager(service)

        assertEquals(550, m.refreshBalance(SKU))
        assertEquals(550, m.balances.value[SKU])
        // The token, never a subject id — the server resolves the subject (migration 159).
        assertEquals(TOKEN, service.balanceOfToken)
    }

    @Test
    fun refreshBalance_without_a_registered_device_is_zero_and_does_not_pollute_the_map() = runTest {
        DeviceTokenStore.clearToken()
        val service = FakeBalanceService(balance = 999)
        val m = manager(service)

        assertEquals(0, m.refreshBalance(SKU))
        // Crucially ABSENT, not 0. A published 0 is indistinguishable from a real empty wallet and
        // would make a host render "you have none" for a user who simply is not signed in yet.
        assertNull(m.balances.value[SKU])
        assertNull(service.balanceOfToken) // never reached the wire
    }

    @Test
    fun spend_publishes_the_servers_new_balance_not_a_locally_computed_one() = runTest {
        // 550 - 120 would be 430 if the client did the arithmetic. The server says 999, which the
        // client could not have derived — so if 999 is published, the server is the writer (AR-013).
        val service = FakeBalanceService(balance = 550, spendResult = 999)
        val m = manager(service)
        m.refreshBalance(SKU)

        val result = m.spend(SKU, quantity = 120, idempotencyKey = "spend-key-1")

        assertEquals(999, result.getOrNull())
        assertEquals(999, m.balances.value[SKU])
    }

    @Test
    fun a_rejected_spend_is_a_failure_and_leaves_the_balance_untouched() = runTest {
        val service = FakeBalanceService(balance = 50, spendResult = null)
        val m = manager(service)
        m.refreshBalance(SKU)

        val result = m.spend(SKU, quantity = 120, idempotencyKey = "spend-key-2")

        assertTrue(result.isFailure, "insufficient funds must be Result.failure, not an exception (AR-012)")
        // Unchanged: a rejected spend that still debited would lose currency the user still owns,
        // and one that "succeeded" would hand over goods nobody paid for.
        assertEquals(50, m.balances.value[SKU])
    }

    @Test
    fun the_callers_idempotency_key_reaches_the_wire_verbatim() = runTest {
        val service = FakeBalanceService(balance = 550, spendResult = 430)
        val m = manager(service)

        m.spend(SKU, quantity = 120, idempotencyKey = "caller-owned-key")

        // Regenerating or dropping the key would make every retry a fresh charge — the precise
        // failure the key exists to prevent (AR-011).
        assertEquals("caller-owned-key", service.spendIdempotencyKey)
        assertEquals(120, service.spendQuantity)
        assertEquals(TOKEN, service.spendToken)
        assertEquals(1, service.spendCallCount)
    }

    @Test
    fun spend_without_a_registered_device_fails_before_reaching_the_wire() = runTest {
        DeviceTokenStore.clearToken()
        val service = FakeBalanceService(balance = 550, spendResult = 430)
        val m = manager(service)

        val result = m.spend(SKU, quantity = 120, idempotencyKey = "spend-key-3")

        assertTrue(result.isFailure)
        assertEquals(0, service.spendCallCount, "a spend with no subject must never reach the server")
    }
}
