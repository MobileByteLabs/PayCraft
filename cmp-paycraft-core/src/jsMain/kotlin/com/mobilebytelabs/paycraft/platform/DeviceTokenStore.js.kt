package com.mobilebytelabs.paycraft.platform

/**
 * JS: localStorage (browser) or ~/.paycraft/device_token file (Node.js).
 * Note: localStorage is clearable. Recovery is clean via OAuth → re-register → new token issued.
 *
 * Values cross into JavaScript as `dynamic` calls, never by naming a Kotlin parameter inside a
 * `js("…")` string: Kotlin/JS does not guarantee a parameter keeps its name in the emitted code, so
 * `js("(function(t){ … })(t)")` threw `ReferenceError: t is not defined` and the token was never saved.
 */
actual object DeviceTokenStore {
    actual fun getToken(): String? = runCatching {
        val storage = localStorageOrNull()
        val value: String? = if (storage != null) {
            storage.getItem(KEY) as String?
        } else {
            val fs = nodeRequire("fs")
            val path = tokenPath()
            if (fs.existsSync(path) as Boolean) (fs.readFileSync(path, "utf8") as String).trim() else null
        }
        value?.ifBlank { null }
    }.getOrNull()

    actual fun saveToken(token: String) {
        runCatching {
            val storage = localStorageOrNull()
            if (storage != null) {
                storage.setItem(KEY, token)
            } else {
                val fs = nodeRequire("fs")
                fs.mkdirSync(tokenDir(), js("({ recursive: true })"))
                fs.writeFileSync(tokenPath(), token)
            }
        }
    }

    actual fun clearToken() {
        runCatching {
            val storage = localStorageOrNull()
            if (storage != null) storage.removeItem(KEY) else nodeRequire("fs").unlinkSync(tokenPath())
        }
    }
}

private const val KEY = "paycraft_device_token"

private fun localStorageOrNull(): dynamic = js("(typeof localStorage !== 'undefined') ? localStorage : null")

private fun nodeRequire(module: String): dynamic = js("require")(module)

private fun tokenDir(): String = (nodeRequire("os").homedir() as String) + "/.paycraft"

private fun tokenPath(): String = tokenDir() + "/device_token"
