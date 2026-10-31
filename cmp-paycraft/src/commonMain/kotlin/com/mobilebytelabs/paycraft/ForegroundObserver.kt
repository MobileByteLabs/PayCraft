package com.mobilebytelabs.paycraft

/**
 * Start calling [PayCraft.onAppForegrounded] each time the app returns to the foreground, so the SDK
 * re-syncs what the store holds without any host wiring. Idempotent: safe on every initialize().
 *
 * Android does this from its Activity tracker (PayCraftInitializer), so its actual is a no-op; iOS
 * observes UIApplicationWillEnterForegroundNotification; platforms with no store do nothing.
 */
internal expect fun installForegroundObserver()
