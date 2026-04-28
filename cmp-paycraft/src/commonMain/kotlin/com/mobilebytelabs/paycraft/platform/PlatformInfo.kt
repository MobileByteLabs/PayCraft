package com.mobilebytelabs.paycraft.platform

/**
 * Provides platform identifier and human-readable device name for device binding.
 * Used in register_device() RPC and displayed in conflict resolution dialog.
 */
expect object PlatformInfo {
    /** One of: "android" | "ios" | "macos" | "desktop" | "web" */
    val platform: String

    /** Human-readable name shown in conflict dialog, e.g. "Rajan's Pixel 8", "iPhone 15 Pro" */
    val deviceName: String

    /**
     * Stable hardware-unique identifier for same-device detection in register_device().
     * Never shown to users. Used exclusively for identity, not display.
     * Sources: ANDROID_ID (Android), identifierForVendor (iOS), NSUserDefaults UUID (macOS),
     *          persisted file UUID (JVM), localStorage UUID (JS/WasmJS).
     */
    val deviceId: String
}
