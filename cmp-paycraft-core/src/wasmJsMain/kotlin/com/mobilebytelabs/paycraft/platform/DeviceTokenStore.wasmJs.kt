package com.mobilebytelabs.paycraft.platform

@JsFun("() => localStorage.getItem('paycraft_device_token')")
external fun getWasmDeviceToken(): String?

@JsFun("(t) => localStorage.setItem('paycraft_device_token', t)")
external fun saveWasmDeviceToken(t: String)

@JsFun("() => localStorage.removeItem('paycraft_device_token')")
external fun clearWasmDeviceToken()

/**
 * WASM JS: localStorage. Clearable, but recovery is clean via OAuth → re-register.
 */
actual object DeviceTokenStore {
    actual fun getToken(): String? = getWasmDeviceToken()
    actual fun saveToken(token: String) = saveWasmDeviceToken(token)
    actual fun clearToken() = clearWasmDeviceToken()
}
