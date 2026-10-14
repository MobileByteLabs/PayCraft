package com.mobilebytelabs.paycraft

/**
 * Where a STORE-billed subscription is managed, per platform.
 *
 * Split out of [PayCraft.manageSubscription] as a pure function of the platform string so every
 * branch is reachable from `commonTest`: `PlatformInfo` is an `expect object`, so a test running on
 * the JVM can only ever observe the JVM actual, and the Android/iOS mappings — the two that matter
 * — would be untestable inside it.
 *
 * `null` means there is nowhere to send this user: a desktop or web build billed through a web
 * provider has no store subscriptions page. Returning null rather than guessing a URL lets the
 * caller hide the affordance instead of opening a page that cannot help, which is the failure this
 * whole path exists to fix.
 */
internal fun storeSubscriptionsUrlFor(platform: String): String? = when (platform.lowercase()) {
    "android" -> "https://play.google.com/store/account/subscriptions"
    // One Apple account page serves both.
    "ios", "macos" -> "https://apps.apple.com/account/subscriptions"
    else -> null
}
