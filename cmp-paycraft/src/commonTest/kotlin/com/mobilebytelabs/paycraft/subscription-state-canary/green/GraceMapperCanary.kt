package com.mobilebytelabs.paycraft.canary.green

import com.mobilebytelabs.paycraft.model.SubscriptionState

/**
 * GREEN canary: CORRECT — maps a grace-period subscription to [SubscriptionState.InGracePeriod]
 * (isActive=true, billingIssue=true). Asserting isActive==true against this mapping PASSES
 * (D6 grace = active correctness rule). Pairs with the RED canary under the sibling
 * subscription-state-canary/red path.
 */
object GraceMapperCanary {
    fun mapGrace(): SubscriptionState = SubscriptionState.InGracePeriod // grace = active
}
