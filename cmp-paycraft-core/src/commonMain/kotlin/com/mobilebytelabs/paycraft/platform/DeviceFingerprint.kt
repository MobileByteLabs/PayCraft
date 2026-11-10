package com.mobilebytelabs.paycraft.platform

/**
 * Stable per-(device, app) fingerprint that uniquely identifies this install
 * to PayCraft Cloud. The SDK sends this as the `device_id` query parameter on
 * every /config request — the server consults the tenant's `test_devices`
 * allow-list to decide whether to surface products marked `is_test_only`.
 *
 * Properties:
 *
 *   - Stable across app launches (so a dashboard-registered fingerprint
 *     persists past restart, OS upgrade, etc.).
 *   - Per-app on a given device (Android SSAID + iOS identifierForVendor +
 *     OS sign-in are naturally app-scoped, so one tenant's testing access
 *     cannot leak to a sibling app on the same hardware).
 *   - Opaque (hash-derived where possible) — no IMEI/MAC/ADID, no PII.
 *
 * The value is shown to tenant developers at `initialize()` time via
 * [com.mobilebytelabs.paycraft.debug.PayCraftLogger] so they can paste it
 * into the dashboard's Testing Devices page to register the device.
 */
expect object DeviceFingerprint {
    fun get(): String
}
