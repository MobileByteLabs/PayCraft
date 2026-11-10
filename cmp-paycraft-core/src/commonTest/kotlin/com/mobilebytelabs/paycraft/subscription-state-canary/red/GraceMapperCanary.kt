package com.mobilebytelabs.paycraft.canary.red

import com.mobilebytelabs.paycraft.model.SubscriptionState

/**
 * RED canary: DELIBERATELY WRONG — maps a grace-period subscription to [SubscriptionState.Expired]
 * (isActive=false). Asserting isActive==true against this mapping FAILS, proving
 * SubscriptionStateMapperTest catches the grace = inactive defect class. Never promoted to production.
 *
 * intentional-noop: this is a red-canary fixture, not production code — the wrong mapping is the point.
 */
object GraceMapperCanary {
    fun mapGrace(): SubscriptionState = SubscriptionState.Expired // WRONG: grace treated as inactive
}
