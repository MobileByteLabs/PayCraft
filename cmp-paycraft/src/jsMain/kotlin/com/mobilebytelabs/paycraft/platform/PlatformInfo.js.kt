package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "web"
    actual val deviceName: String
        get() = detectBrowserName()
    actual val deviceId: String
        get() = loadOrCreateWebDeviceId()
    actual val country: String?
        get() = detectWebCountry().takeIf { it.isNotBlank() }

    // ── Build kind, from the SERVING ORIGIN ───────────────────────────────────────────────────
    //
    // A production web bundle is not served from loopback. `location.hostname` is therefore the
    // honest structural signal the web has — there is no signature or package to inspect.
    //
    // Narrow on purpose: loopback and `.local` only. A staging host on a real domain reports
    // Release, which is the safe direction — it keeps real money working and is visible the first
    // time someone checks out, whereas a wrong "debug" silently takes no payments at all.
    //
    // Anything we cannot read (no `location`, e.g. a worker or SSR context) is Unknown, not Release.
    private val verdict: Pair<BuildKind, String>
        get() = runCatching {
            val host = webHostname()
            when {
                host == null || host.isBlank() -> BuildKind.Unknown to "web:no-location"
                host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]" ->
                    BuildKind.Debug to "web:loopback-origin"
                host.endsWith(".local") -> BuildKind.Debug to "web:mdns-local-origin"
                else -> BuildKind.Release to "web:public-origin"
            }
        }.getOrElse { BuildKind.Unknown to "web:location-read-failed" }

    actual val buildKind: BuildKind get() = verdict.first
    actual val buildKindEvidence: String get() = verdict.second
    actual val isDebugBuild: Boolean get() = buildKind == BuildKind.Debug
}

private fun detectWebCountry(): String = js(
    """
    (function() {
        if (typeof navigator === 'undefined' || !navigator.language) return '';
        var parts = navigator.language.split('-');
        return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
    })()
""",
)

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

private fun webHostname(): String? = js(
    """
    (function() {
        try {
            if (typeof location === 'undefined' || !location) return null;
            return location.hostname || null;
        } catch (e) { return null; }
    })()
    """,
) as String?
