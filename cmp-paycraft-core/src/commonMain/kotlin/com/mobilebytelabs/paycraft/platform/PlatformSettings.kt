package com.mobilebytelabs.paycraft.platform

import com.russhwolf.settings.Settings

/**
 * The SDK's default key-value store. Every place that used the no-arg `Settings()` goes through here,
 * because that factory is only safe where the platform has a default store: on JS it wraps
 * `localStorage`, which Node.js does not have, so the first read crashed with
 * `Cannot read properties of undefined`. The JS actual falls back to an in-memory store there.
 */
internal expect fun platformSettings(): Settings
