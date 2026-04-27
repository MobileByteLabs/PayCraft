package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "web"
    actual val deviceName: String
        get() = detectBrowserName()
}

private fun detectBrowserName(): String = js(
    """
    (function() {
        if (typeof navigator === 'undefined') return 'Node.js';
        var ua = navigator.userAgent;
        if (ua.indexOf('Chrome') !== -1)  return 'Chrome Browser';
        if (ua.indexOf('Firefox') !== -1) return 'Firefox Browser';
        if (ua.indexOf('Safari') !== -1)  return 'Safari Browser';
        return 'Web Browser';
    })()
""",
)
