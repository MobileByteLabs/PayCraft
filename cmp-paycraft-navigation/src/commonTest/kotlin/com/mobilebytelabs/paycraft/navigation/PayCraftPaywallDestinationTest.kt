package com.mobilebytelabs.paycraft.navigation

import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The route contract.
 *
 * These assert the properties Navigation Compose relies on, and that a consumer would only
 * discover were broken at runtime:
 *
 *  · the route is SERIALIZABLE — type-safe navigation keys destinations by serializer, and a
 *    route without one fails when the graph is built, not when it is written
 *  · the route is a stable singleton — `data object`, so two references are the same destination
 *  · the route's serial NAME is part of the public contract: it ends up in the back stack and in
 *    deep links, so renaming the class is a breaking change for any host that persisted it
 *
 * The destination BODY is not asserted here. `payCraftPaywallDestination` delegates straight to
 * `PayCraftPaywall`, whose behaviour — including the `onSubscribed` purchase watch — is tested in
 * :cmp-paycraft. Re-testing it through a NavHost would assert Navigation Compose's own wiring.
 */
class PayCraftPaywallDestinationTest {

    @Test
    fun theRouteIsSerializable() {
        val serializer = serializer<PayCraftPaywallRoute>()
        assertNotNull(serializer.descriptor)
    }

    @Test
    fun theRouteIsAStableSingleton() {
        // `data object`: every reference is the same destination. If this became a `class`, two
        // navigations would build two back-stack entries for one screen.
        assertEquals(PayCraftPaywallRoute, PayCraftPaywallRoute)
        assertTrue(PayCraftPaywallRoute === PayCraftPaywallRoute)
    }

    @Test
    fun theSerialNameIsPartOfThePublicContract() {
        // Pinned deliberately. This string reaches the back stack and any deep link a host wires,
        // so a rename is a breaking change for a consumer that persisted it — this test is what
        // makes that break visible here rather than in their app.
        assertEquals(
            "com.mobilebytelabs.paycraft.navigation.PayCraftPaywallRoute",
            serializer<PayCraftPaywallRoute>().descriptor.serialName,
        )
    }

    @Test
    fun theRouteRoundTripsThroughJson() {
        // Navigation Compose encodes route objects when saving state. An object with no fields
        // still has to survive the trip.
        val encoded = Json.encodeToString(serializer<PayCraftPaywallRoute>(), PayCraftPaywallRoute)
        assertEquals(PayCraftPaywallRoute, Json.decodeFromString(serializer<PayCraftPaywallRoute>(), encoded))
    }
}
