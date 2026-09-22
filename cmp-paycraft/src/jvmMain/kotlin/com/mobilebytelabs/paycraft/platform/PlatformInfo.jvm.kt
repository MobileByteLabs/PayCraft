package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "desktop"
    actual val deviceName: String
        get() = "${System.getProperty("os.name")} (${System.getProperty("user.name")})"
    actual val deviceId: String
        get() = loadOrCreateJvmDeviceId()
    actual val country: String?
        get() = java.util.Locale.getDefault().country.takeIf { it.isNotBlank() }

    // No equivalent of FLAG_DEBUGGABLE on the JVM. A JDWP agent means someone is running this from
    // an IDE/debugger, which is the closest honest signal; a packaged desktop app has none. Anything
    // else would be a guess, and per the expect-declaration an unknown defaults to LIVE.
    actual val isDebugBuild: Boolean
        get() = runCatching {
            java.lang.management.ManagementFactory.getRuntimeMXBean()
                .inputArguments.any { it.contains("jdwp", ignoreCase = true) }
        }.getOrDefault(false)
}

private fun loadOrCreateJvmDeviceId(): String {
    val file = java.io.File(System.getProperty("user.home"), ".paycraft/device_id")
    if (file.exists()) return file.readText().trim()
    val id = java.util.UUID.randomUUID().toString()
    file.parentFile.mkdirs()
    file.writeText(id)
    return id

}
