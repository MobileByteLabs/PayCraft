package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "web"
    actual val deviceName: String
        get() = detectBrowserName()
    actual val deviceId: String
        get() = loadOrCreateWebDeviceId()
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

private fun loadOrCreateWebDeviceId(): String = js(
    """
    (function() {
        var key = 'paycraft_device_id';
        var stored = localStorage.getItem(key);
        if (stored) return stored;
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        var id = Array.from(bytes).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        localStorage.setItem(key, id);
        return id;
    })()
""",
)
