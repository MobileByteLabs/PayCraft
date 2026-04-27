package com.mobilebytelabs.paycraft.platform

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFBridgingRetain
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/**
 * iOS: Keychain storage with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.
 * Token SURVIVES app uninstall and reinstall — the only platform that does this natively.
 */
@OptIn(ExperimentalForeignApi::class)
actual object DeviceTokenStore {
    private const val SERVICE = "com.mobilebytelabs.paycraft"
    private const val ACCOUNT = "device_token"

    actual fun getToken(): String? {
        memScoped {
            val query = CFDictionaryCreateMutable(null, 5, null, null)!!
            CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword)
            CFDictionarySetValue(query, kSecAttrService, CFBridgingRetain(SERVICE))
            CFDictionarySetValue(query, kSecAttrAccount, CFBridgingRetain(ACCOUNT))
            CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue)
            CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne)

            val result = alloc<CFTypeRefVar>()
            val status = SecItemCopyMatching(query, result.ptr)
            if (status != errSecSuccess) return null

            val data = result.value as? NSData ?: return null
            return NSString.create(data, NSUTF8StringEncoding) as? String
        }
    }

    actual fun saveToken(token: String) {
        clearToken()
        memScoped {
            val data = (token as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return
            val item = CFDictionaryCreateMutable(null, 5, null, null)!!
            CFDictionarySetValue(item, kSecClass, kSecClassGenericPassword)
            CFDictionarySetValue(item, kSecAttrService, CFBridgingRetain(SERVICE))
            CFDictionarySetValue(item, kSecAttrAccount, CFBridgingRetain(ACCOUNT))
            CFDictionarySetValue(item, kSecValueData, CFBridgingRetain(data))
            CFDictionarySetValue(item, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
            SecItemAdd(item, null)
        }
    }

    actual fun clearToken() {
        memScoped {
            val query = CFDictionaryCreateMutable(null, 3, null, null)!!
            CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword)
            CFDictionarySetValue(query, kSecAttrService, CFBridgingRetain(SERVICE))
            CFDictionarySetValue(query, kSecAttrAccount, CFBridgingRetain(ACCOUNT))
            SecItemDelete(query)
        }
    }
}
