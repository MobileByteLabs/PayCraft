package com.mobilebytelabs.paycraft.platform

/**
 * JS: localStorage (browser) or ~/.paycraft/device_token file (Node.js).
 * Note: localStorage is clearable. Recovery is clean via OAuth → re-register → new token issued.
 */
actual object DeviceTokenStore {
    actual fun getToken(): String? = getTokenJs()?.ifBlank { null }
    actual fun saveToken(token: String) {
        saveTokenJs(token)
    }
    actual fun clearToken() {
        clearTokenJs()
    }
}

@Suppress("UNUSED_PARAMETER")
private fun getTokenJs(): String? = js(
    """
    (function() {
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('paycraft_device_token');
            }
            var fs = require('fs');
            var path = require('os').homedir() + '/.paycraft/device_token';
            return fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim() : null;
        } catch(e) { return null; }
    })()
""",
)

@Suppress("UNUSED_PARAMETER")
private fun saveTokenJs(t: String): Unit = js(
    """
    (function(t) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('paycraft_device_token', t);
                return;
            }
            var fs = require('fs');
            var dir = require('os').homedir() + '/.paycraft';
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dir + '/device_token', t);
        } catch(e) {}
    })(t)
""",
)

private fun clearTokenJs(): Unit = js(
    """
    (function() {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('paycraft_device_token');
                return;
            }
            require('fs').unlinkSync(require('os').homedir() + '/.paycraft/device_token');
        } catch(e) {}
    })()
""",
)
