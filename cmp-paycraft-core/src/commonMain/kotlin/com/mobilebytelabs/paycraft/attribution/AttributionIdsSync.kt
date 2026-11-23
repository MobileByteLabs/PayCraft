package com.mobilebytelabs.paycraft.attribution

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The app's ad/analytics ids (Firebase `app_instance_id`, AppsFlyer id) for this device, delivered to the
 * `attribution-ids` function once the device has a token — the server then forwards verified purchases,
 * renewals and refunds to GA4 / AppsFlyer for this buyer (migration 208).
 *
 * [set] remembers the ids (a null keeps the one already set); [flush] sends them when there is a token and
 * they — or the token — changed since the last successful send. Fail-soft: a failed or throwing send is
 * retried on the next flush and never propagates.
 */
internal class AttributionIdsSync(
    private val send: suspend (deviceToken: String, firebaseAppInstanceId: String?, appsFlyerId: String?) -> Boolean,
) {
    private val mutex = Mutex()
    private var firebaseAppInstanceId: String? = null
    private var appsFlyerId: String? = null
    private var sentKey: String? = null

    fun set(firebaseAppInstanceId: String?, appsFlyerId: String?) {
        firebaseAppInstanceId?.trim()?.ifBlank { null }?.let { this.firebaseAppInstanceId = it }
        appsFlyerId?.trim()?.ifBlank { null }?.let { this.appsFlyerId = it }
    }

    /** True when nothing is left to send (sent, unchanged, or no ids); false = try again later. */
    suspend fun flush(deviceToken: String?): Boolean = mutex.withLock {
        val firebase = firebaseAppInstanceId
        val appsFlyer = appsFlyerId
        if (firebase == null && appsFlyer == null) return true
        if (deviceToken.isNullOrBlank()) return false
        val key = "$deviceToken|$firebase|$appsFlyer"
        if (key == sentKey) return true
        val ok = try {
            send(deviceToken, firebase, appsFlyer)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            false
        }
        if (ok) sentKey = key
        ok
    }

    companion object {
        /** `attribution-ids` body; an absent id leaves the stored one untouched server-side. */
        fun body(apiKey: String, deviceToken: String, firebaseAppInstanceId: String?, appsFlyerId: String?): JsonObject =
            buildJsonObject {
                put("apiKey", apiKey)
                put("deviceToken", deviceToken)
                firebaseAppInstanceId?.let { put("firebaseAppInstanceId", it) }
                appsFlyerId?.let { put("appsFlyerId", it) }
            }
    }
}
