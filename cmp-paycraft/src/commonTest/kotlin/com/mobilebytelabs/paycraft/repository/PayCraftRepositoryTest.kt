/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The facade's contract, and the parity that keeps [FakePayCraftRepository] honest.
 *
 * The parity test is the load-bearing one. `FakePayCraftRepository` is what lets consumers drop their
 * hand-written wrapper, so if someone adds a member to [PayCraftRepository] and forgets the fake, the
 * fake stops being a substitute and every consumer test built on it is testing a different shape than
 * production. Kotlin's compiler enforces that for an `interface` implementor — which is exactly why
 * the fake implements the interface rather than duplicating its members — so this file's job is to
 * assert the BEHAVIOURS that compilation cannot: that the fake's flows actually emit, that its
 * recorders record, and that its unhappy paths are reachable.
 */
class PayCraftRepositoryTest {

    private fun plan(id: String, rank: Int = 0) = BillingPlan(
        id = id,
        name = id,
        price = "$6.99",
        interval = "month",
        rank = rank,
    )

    @Test
    fun fake_is_a_structural_substitute_for_the_interface() {
        // Compile-time proof: this only builds while the fake implements every member. The
        // assignment is the assertion — a missing member is a compile error, not a runtime failure.
        val repo: PayCraftRepository = FakePayCraftRepository()
        assertFalse(repo.isPremium.value, "a fresh fake must default to NOT premium")
        assertIs<BillingState.Free>(repo.billingState.value)
        assertTrue(repo.plans.value.isEmpty())
        assertFalse(repo.isInTrial.value)
    }

    @Test
    fun premium_flip_is_observable_mid_test() = runTest {
        val fake = FakePayCraftRepository(premium = false)
        val repo: PayCraftRepository = fake

        assertFalse(repo.isPremium.value)
        fake.setPremium(true)

        // The whole point of the fake: a gating test can flip entitlement and assert the collector
        // reacted. A fake whose flows never changed would pass any gating test vacuously.
        assertTrue(repo.isPremium.value)
        assertIs<BillingState.Premium>(repo.billingState.value)
        assertTrue(repo.subscriptionStatus.value.isPremium)
    }

    @Test
    fun checkout_records_rather_than_performs() {
        val fake = FakePayCraftRepository()
        val repo: PayCraftRepository = fake
        val monthly = plan("test_monthly")

        repo.checkout(monthly, email = "a@b.com")

        assertEquals(1, fake.checkoutCalls.size)
        assertEquals(monthly to "a@b.com", fake.checkoutCalls.single())
        // checkout returns Unit by contract — there is no synchronous verdict to assert, which is
        // why the interface does not pretend to return one.
    }

    @Test
    fun manage_subscription_and_refresh_are_recorded() {
        val fake = FakePayCraftRepository()
        val repo: PayCraftRepository = fake

        repo.manageSubscription("a@b.com")
        repo.refresh(force = true)
        repo.refresh(force = false)

        assertEquals(listOf("a@b.com"), fake.manageSubscriptionCalls)
        assertEquals(listOf(true, false), fake.refreshCalls)
    }

    @Test
    fun restore_returns_the_configured_entitlement() = runTest {
        val expected = FakePayCraftRepository.activeEntitlement(userId = "u1")
        val repo: PayCraftRepository = FakePayCraftRepository(restoreResult = expected)

        assertEquals(expected, repo.restore())
    }

    @Test
    fun restore_without_a_configured_result_fails_loudly() = runTest {
        val repo: PayCraftRepository = FakePayCraftRepository()
        // A fake that silently returned a default entitlement would make "restore worked" untestable
        // — the unhappy path has to be reachable.
        var threw = false
        try {
            repo.restore()
        } catch (e: IllegalStateException) {
            threw = true
            assertTrue(e.message!!.contains("restoreResult"))
        }
        assertTrue(threw, "restore() with no configured result must throw, not return a default")
    }

    @Test
    fun plans_updates_are_observable() {
        val fake = FakePayCraftRepository()
        val repo: PayCraftRepository = fake

        assertTrue(repo.plans.value.isEmpty())
        fake.setPlans(listOf(plan("m", rank = 0), plan("y", rank = 1)))

        // Mirrors the real impl's reason for projecting a StateFlow instead of reading
        // `PayCraft.plans`: a paywall composed before config lands must see the second value.
        assertEquals(listOf("m", "y"), repo.plans.value.map { it.id })
    }
}
