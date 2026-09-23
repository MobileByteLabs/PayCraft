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

    /**
     * ISO 3166-1 alpha-2 country code of the device's current region (e.g. "US", "IN"),
     * or null when undetectable. The SDK's device-side input to the single currency/country
     * decision point (PayCraft locale resolution): `InitOptions.localeOverride` wins, then
     * this, then the cloud config locale, then "US". Drives which per-locale price + which
     * per-currency provider checkout link is used.
     */
    val country: String?

    /**
     * `true` when the CONSUMING APP is a debug build. Drives the default test/live mode so a host
     * app never has to inject two keys or flip a flag (`PayCraft.mode`).
     *
     * It must describe the HOST, not this library. A library's own `BuildConfig.DEBUG` reflects how
     * the AAR was compiled — always `false` in a published artifact — so reading it would report
     * every consumer as release, including the developer's own debug build. Android therefore reads
     * the host's `ApplicationInfo.FLAG_DEBUGGABLE` and iOS reads `Platform.isDebugBinary`; both are
     * properties of the running application.
     *
     * Where no honest signal exists (JVM, JS, WasmJs) this returns `false` — i.e. LIVE. That
     * asymmetry is deliberate: guessing "debug" wrong means a shipped app silently charges nobody
     * and the revenue loss is invisible, while guessing "live" wrong is caught the first time a
     * developer sees a real charge. An explicit `initialize(mode = …)` override covers those
     * platforms.
     */
    val isDebugBuild: Boolean
}
