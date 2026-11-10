/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Pure unit tests for the Phase-4 MonetizationMode precedence resolver (AC-9)
 * plus the two data-carrier predicates that gate TrialManaged auto-present
 * (AC-11) and the ad-free entitlement helper (AC-12). Keeps the resolver
 * contract isolated from PayCraft singleton state so a resolver regression
 * fails here before it manifests as a paywall dispatch defect downstream.
 */
package com.mobilebytelabs.paycraft.core

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MonetizationModeTest {

    // Reset the process-wide singletons before and after every test so a
    // preceding suite (or a stray helper leaving state behind) can't taint
    // an assertion here. AdFreeEntitlement + SessionDebounce are objects,
    // so their state persists across the JVM lifetime by default.
    @BeforeTest
    fun resetSingletonState() {
        AdFreeEntitlement.resetForTest()
        SessionDebounce.resetForTest()
    }

    @AfterTest
    fun clearSingletonStateAfter() {
        AdFreeEntitlement.resetForTest()
        SessionDebounce.resetForTest()
    }

    // ─── MonetizationModeResolver (AC-9) ─────────────────────────────────────

    @Test
    fun resolver_configMode_wins_over_initFlag() {
        // init=AdSupported + config=TrialManaged → cloud wins → TrialManaged.
        val resolved = MonetizationModeResolver.resolve(
            initFlag = MonetizationMode.AdSupported,
            configMode = MonetizationMode.TrialManaged,
        )
        assertEquals(MonetizationMode.TrialManaged, resolved)
    }

    @Test
    fun resolver_configMode_wins_when_flipped_the_other_way() {
        // init=TrialManaged + config=AdSupported → cloud still wins → AdSupported.
        val resolved = MonetizationModeResolver.resolve(
            initFlag = MonetizationMode.TrialManaged,
            configMode = MonetizationMode.AdSupported,
        )
        assertEquals(MonetizationMode.AdSupported, resolved)
    }

    @Test
    fun resolver_falls_back_to_initFlag_when_config_absent() {
        // Cold start / tenant without a `mode` column → resolver returns the init flag.
        assertEquals(
            MonetizationMode.AdSupported,
            MonetizationModeResolver.resolve(MonetizationMode.AdSupported, configMode = null),
        )
        assertEquals(
            MonetizationMode.TrialManaged,
            MonetizationModeResolver.resolve(MonetizationMode.TrialManaged, configMode = null),
        )
    }

    // ─── TrialSnapshot predicate (AC-11 gate input) ──────────────────────────

    @Test
    fun trialSnapshot_active_isActiveOrNearExpiry_is_true() {
        val snap = TrialSnapshot(isActive = true, hasEnded = false, daysRemaining = 5)
        assertTrue(snap.isActiveOrNearExpiry)
    }

    @Test
    fun trialSnapshot_justEnded_isActiveOrNearExpiry_is_true() {
        val snap = TrialSnapshot(isActive = false, hasEnded = true, daysRemaining = 0)
        assertTrue(snap.isActiveOrNearExpiry, "just-ended trials must open the convert-or-churn moment")
    }

    @Test
    fun trialSnapshot_none_isActiveOrNearExpiry_is_false() {
        assertFalse(TrialSnapshot.None.isActiveOrNearExpiry, "never-had-a-trial must NOT trigger auto-present")
    }

    // ─── EntitlementSnapshot ────────────────────────────────────────────────

    @Test
    fun entitlementSnapshot_premium_populates_default_entitlement_set() {
        val snap = EntitlementSnapshot(isPremium = true)
        assertTrue(snap.isActive("premium"))
        assertFalse(snap.isActive("some-other-entitlement"))
    }

    @Test
    fun entitlementSnapshot_free_has_empty_active_set() {
        val snap = EntitlementSnapshot(isPremium = false)
        assertFalse(snap.isActive("premium"))
        assertTrue(snap.activeEntitlements.isEmpty())
    }

    // ─── AdFreeEntitlement + SessionDebounce (AC-11, AC-12 helpers) ─────────

    @Test
    fun adFreeEntitlement_set_updates_flow_value() {
        assertFalse(AdFreeEntitlement.isAdFree.value)
        AdFreeEntitlement.set(true)
        assertTrue(AdFreeEntitlement.isAdFree.value)
        AdFreeEntitlement.set(false)
        assertFalse(AdFreeEntitlement.isAdFree.value)
    }

    @Test
    fun sessionDebounce_mark_then_wasShown_returns_true() {
        assertFalse(SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY))
        SessionDebounce.mark(SessionDebounce.APP_OPEN_KEY)
        assertTrue(SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY))
    }

    @Test
    fun sessionDebounce_marks_are_key_scoped() {
        SessionDebounce.mark("some-other-key")
        // The trial-managed app-open key was never marked — must still return false.
        assertFalse(SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY))
        assertTrue(SessionDebounce.wasShown("some-other-key"))
    }
}
