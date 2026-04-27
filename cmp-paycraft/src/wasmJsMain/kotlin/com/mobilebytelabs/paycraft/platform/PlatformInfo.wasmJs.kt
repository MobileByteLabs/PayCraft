package com.mobilebytelabs.paycraft.platform

@JsFun(
    """() => {
    var ua = navigator.userAgent;
    if (ua.indexOf('Chrome') !== -1)  return 'Chrome Browser';
    if (ua.indexOf('Firefox') !== -1) return 'Firefox Browser';
    if (ua.indexOf('Safari') !== -1)  return 'Safari Browser';
    return 'Web Browser';
}""",
)
external fun detectWasmBrowserName(): String

actual object PlatformInfo {
    actual val platform: String = "web"
    actual val deviceName: String
        get() = detectWasmBrowserName()
}
