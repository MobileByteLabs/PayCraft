package com.mobilebytelabs.paycraft.platform

/**
 * JS: random UUID generated once, persisted in `localStorage` (browser) or
 * `~/.paycraft/device_fingerprint` (Node.js) so the same value is returned
 * on subsequent loads. Truncated to 16 hex chars to keep the shape
 * consistent with mobile platforms.
 *
 * Mirrors the wasmJs implementation (`DeviceFingerprint.wasmJs.kt`) but
 * uses the JS source-set's `js(...)` literal form rather than `@JsFun`,
 * matching the pattern of other actuals in `jsMain/` (DeviceTokenStore,
 * PlatformInfo, TimeProvider).
 */
actual object DeviceFingerprint {
    actual fun get(): String {
        val existing = getFingerprintJs()?.ifBlank { null }
        val raw = existing ?: randomUuidJs().also { saveFingerprintJs(it) }
        return raw.replace("-", "").lowercase().take(16)
    }
}

private fun getFingerprintJs(): String? = js(
    """
    (function() {
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('paycraft_device_fingerprint');
            }
            var fs = require('fs');
            var path = require('os').homedir() + '/.paycraft/device_fingerprint';
            return fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim() : null;
        } catch(e) { return null; }
    })()
""",
)

@Suppress("UNUSED_PARAMETER")
private fun saveFingerprintJs(value: String) {
    js(
        """
        (function(v) {
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('paycraft_device_fingerprint', v);
                    return;
                }
                var fs = require('fs');
                var path = require('path');
                var home = require('os').homedir();
                var dir = path.join(home, '.paycraft');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, 'device_fingerprint'), v, 'utf8');
            } catch(e) { /* swallow — fingerprint is best-effort */ }
        })(value)
    """,
    )
}

private fun randomUuidJs(): String = js(
    """
    (function() {
        try {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
            }
        } catch(e) { /* fall through */ }
        // Fallback: RFC4122-ish random hex.
        var s = '';
        for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    })()
""",
)
