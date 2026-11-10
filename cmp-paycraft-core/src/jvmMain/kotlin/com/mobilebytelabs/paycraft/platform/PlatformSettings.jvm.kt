package com.mobilebytelabs.paycraft.platform

import com.russhwolf.settings.PropertiesSettings
import com.russhwolf.settings.Settings
import java.util.Properties

/**
 * Desktop: the user's java.util.prefs node (the no-arg `Settings()`), shared by every JVM on the machine.
 *
 * Test JVMs set `-Dpaycraft.settings=memory` (root build.gradle.kts) and get ONE in-memory store per JVM
 * instead: tests stay isolated from each other's processes and never write the developer's real preferences.
 */
internal actual fun platformSettings(): Settings =
    if (System.getProperty(SETTINGS_PROPERTY) == "memory") testStore else Settings()

private const val SETTINGS_PROPERTY = "paycraft.settings"

private val testStore: Settings by lazy { PropertiesSettings(Properties()) }
