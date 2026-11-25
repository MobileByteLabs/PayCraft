package com.mobilebytelabs.paycraft.platform

/** No reminder notifications on this platform (desktop (JVM) has no OS reminder surface the SDK posts to), so no permission to hold or ask for. */
internal actual object NotificationPermission {
    actual suspend fun isGranted(): Boolean = false

    actual suspend fun request(): Boolean = false
}
