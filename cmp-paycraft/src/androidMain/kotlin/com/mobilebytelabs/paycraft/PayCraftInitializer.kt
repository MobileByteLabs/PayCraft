package com.mobilebytelabs.paycraft

import android.content.Context
import androidx.startup.Initializer

/**
 * androidx-startup [Initializer] that wires the Android application Context
 * into [PayCraftPlatform] at app start — BEFORE `Application.onCreate` runs.
 *
 * Why this exists:
 *
 *   With this initializer the consumer's `Application.onCreate` only needs to
 *   call `PayCraft.initialize(apiKey)` from commonMain. The Android-specific
 *   Context handoff happens automatically via the AndroidX Startup framework
 *   — no platform-specific bootstrap leaks into the consumer's androidMain.
 *
 * Disabling:
 *
 *   Most apps don't need to. If a host app wants to delay or skip the
 *   handoff (e.g. lazy bootstrap for cold-start optimisation), they can
 *   remove the manifest provider node via tools:node="remove":
 *
 *   ```xml
 *   <provider
 *     android:name="androidx.startup.InitializationProvider"
 *     android:authorities="${applicationId}.androidx-startup"
 *     android:exported="false"
 *     tools:node="merge">
 *     <meta-data
 *       android:name="com.mobilebytelabs.paycraft.PayCraftInitializer"
 *       tools:node="remove" />
 *   </provider>
 *   ```
 *
 *   …and then call `PayCraftPlatform.init(applicationContext)` themselves.
 */
class PayCraftInitializer : Initializer<Unit> {
    override fun create(context: Context) {
        PayCraftPlatform.init(context.applicationContext)
    }

    override fun dependencies(): List<Class<out Initializer<*>>> = emptyList()
}
