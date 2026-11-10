package com.mobilebytelabs.paycraft.web

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal const val TOKEN_KEY = "paycraft_web_token"
internal const val EMAIL_KEY = "paycraft_web_email"
internal const val PREMIUM_KEY = "paycraft_web_premium"
internal const val DEVICE_ID_KEY = "paycraft_web_device_id"

/** How long a cached premium answer is trusted for the synchronous `isAdFree()` check. */
internal const val PREMIUM_CACHE_TTL_MS: Double = 6 * 60 * 60 * 1000.0

/** Minimal key/value storage seam (localStorage in a browser, a map in tests). */
internal interface KeyValue {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun remove(key: String)
}

/**
 * `localStorage` when the page has it; nothing otherwise (static-site build, private modes that
 * throw on access). Never throws: the caller treats "no storage" as "not signed in".
 */
internal class BrowserKeyValue : KeyValue {
    private val storage: dynamic
        get() = js("(typeof localStorage !== 'undefined') ? localStorage : null")

    override fun get(key: String): String? = storage?.getItem(key) as String?

    override fun set(key: String, value: String) {
        storage?.setItem(key, value)
    }

    override fun remove(key: String) {
        storage?.removeItem(key)
    }
}

@Serializable
internal class PremiumCache(val isPremium: Boolean, val email: String? = null, val at: Double)

/**
 * The SDK's persistent state: device id, server token, signed-in email and the cached premium
 * answer. Every access is guarded — a storage error (blocked site data, quota, private mode) must
 * never break the page that embeds the SDK, so reads fall back to null and writes are dropped.
 */
internal class TokenStore(private val kv: KeyValue) {
    private val json = Json { ignoreUnknownKeys = true }

    fun token(): String? = read(TOKEN_KEY)
    fun email(): String? = read(EMAIL_KEY)
    fun deviceId(): String? = read(DEVICE_ID_KEY)

    fun saveSignIn(token: String, email: String) {
        write(TOKEN_KEY, token)
        write(EMAIL_KEY, email)
        delete(PREMIUM_KEY)
    }

    fun saveDeviceId(id: String) = write(DEVICE_ID_KEY, id)

    fun premium(): PremiumCache? =
        read(PREMIUM_KEY)?.let { runCatching { json.decodeFromString(PremiumCache.serializer(), it) }.getOrNull() }

    fun savePremium(cache: PremiumCache) = write(PREMIUM_KEY, json.encodeToString(PremiumCache.serializer(), cache))

    /** Signs out: forgets the identity and premium answer; keeps the device id (it names this browser). */
    fun clear() {
        delete(TOKEN_KEY)
        delete(EMAIL_KEY)
        delete(PREMIUM_KEY)
    }

    private fun read(key: String): String? = runCatching { kv.get(key) }.getOrNull()

    private fun write(key: String, value: String) {
        runCatching { kv.set(key, value) }
    }

    private fun delete(key: String) {
        runCatching { kv.remove(key) }
    }
}
