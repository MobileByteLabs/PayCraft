package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSBundle
import platform.Foundation.NSLocale
import platform.Foundation.countryCode
import platform.Foundation.currentLocale
import platform.Foundation.lastPathComponent
import platform.UIKit.UIDevice

actual object PlatformInfo {
    actual val platform: String = "ios"

    // ── Build kind, from the APP BUNDLE's provisioning identity ───────────────────────────────
    //
    // An App Store binary structurally has NO `embedded.mobileprovision`: Apple strips it during
    // store processing. Development, ad-hoc and TestFlight builds all embed one. That is a fact of
    // how Apple distributes software, not a flag anyone sets — the iOS analogue of Android's debug
    // keystore signature.
    //
    // Corroborated by the receipt name: a development or TestFlight install carries
    // `sandboxReceipt`, an App Store install carries `receipt`. Checked SECOND because a fresh
    // install may have no receipt at all until the first validation, so its absence proves nothing.
    //
    // `Platform.isDebugBinary` is kept as the last signal rather than the first. It reports how the
    // KOTLIN FRAMEWORK was compiled, which usually tracks the Xcode configuration but is a property
    // of this library's build, not of the shipped application — exactly the distinction the
    // expect-declaration warns about.
    @OptIn(kotlin.experimental.ExperimentalNativeApi::class)
    private val verdict: Pair<BuildKind, String>
        get() = runCatching {
            val hasProfile = NSBundle.mainBundle
                .pathForResource("embedded", ofType = "mobileprovision") != null
            val receipt = NSBundle.mainBundle.appStoreReceiptURL?.lastPathComponent
            when {
                hasProfile -> BuildKind.Debug to "ios:embedded-provisioning-profile"
                receipt == "sandboxReceipt" -> BuildKind.Debug to "ios:sandbox-receipt"
                receipt == "receipt" -> BuildKind.Release to "ios:app-store-receipt"
                // No embedded profile and no receipt yet: store-processed binaries lose the profile,
                // so absence points to Release. Fall back to how the framework was compiled.
                kotlin.native.Platform.isDebugBinary -> BuildKind.Debug to "ios:debug-framework-binary"
                else -> BuildKind.Release to "ios:no-embedded-profile"
            }
        }.getOrElse { BuildKind.Unknown to "ios:bundle-read-failed" }

    actual val buildKind: BuildKind get() = verdict.first
    actual val buildKindEvidence: String get() = verdict.second
    actual val isDebugBuild: Boolean get() = buildKind == BuildKind.Debug

    // UIDevice.currentDevice.name is the user-assigned device name: "Rajan's iPhone"
    actual val deviceName: String
        get() = UIDevice.currentDevice.name

    actual val deviceId: String
        get() = UIDevice.currentDevice.identifierForVendor?.UUIDString ?: "ios-unknown"

    actual val country: String?
        get() = NSLocale.currentLocale.countryCode?.takeIf { it.isNotBlank() }
}
