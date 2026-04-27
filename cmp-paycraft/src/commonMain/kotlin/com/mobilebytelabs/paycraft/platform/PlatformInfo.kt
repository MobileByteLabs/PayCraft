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
}
