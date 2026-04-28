package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "desktop"
    actual val deviceName: String
        get() = "${System.getProperty("os.name")} (${System.getProperty("user.name")})"
    actual val deviceId: String
        get() = loadOrCreateJvmDeviceId()
}

private fun loadOrCreateJvmDeviceId(): String {
    val file = java.io.File(System.getProperty("user.home"), ".paycraft/device_id")
    if (file.exists()) return file.readText().trim()
    val id = java.util.UUID.randomUUID().toString()
    file.parentFile.mkdirs()
    file.writeText(id)
    return id
}
