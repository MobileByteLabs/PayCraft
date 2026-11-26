package com.mobilebytelabs.paycraft.platform

/** No reminder notifications on this platform (a web page has no reminder surface that outlives it), so no permission to hold or ask for. */
internal actual object NotificationPermission {
    actual suspend fun isGranted(): Boolean = false

    actual suspend fun request(): Boolean = false
}
