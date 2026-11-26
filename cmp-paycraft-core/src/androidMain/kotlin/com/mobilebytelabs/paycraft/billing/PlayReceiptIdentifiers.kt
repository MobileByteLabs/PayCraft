package com.mobilebytelabs.paycraft.billing

/** Play's cap on `obfuscatedAccountId` and `obfuscatedProfileId`. */
internal const val PLAY_OBFUSCATED_ID_MAX = 64

/**
 * Stamps a Play purchase with WHO is buying and WHICH attempt it is — the two receipt fields Play returns on every
 * later read of the purchase (subscriptionsv2 `externalAccountIdentifiers`), so the server can attribute it without
 * trusting the client:
 *
 * - **account id** — the app user. Play requires it non-identifying, so a stable hash of [appUserId], never the raw
 *   email. Unchanged by attempt tracking: entitlement attribution keeps reading it exactly as before.
 * - **profile id** — the purchase attempt (paycraft-attempt-observability D5). Sent as-is: [attemptId] is a random
 *   `<millis>-<hex>` that identifies no one, and `google-rtdn` / `register-play-purchase` read it back verbatim as the
 *   attempt id (`resolveAttemptIdFromPlay`) — hashing it would break that join. An id Play would refuse (over 64
 *   characters) is left off rather than failing the purchase; the server still maps the purchase token to the
 *   attempt through `register-play-purchase`.
 */
internal fun applyReceiptIdentifiers(
    appUserId: String?,
    attemptId: String?,
    setAccountId: (String) -> Any?,
    setProfileId: (String) -> Any?,
) {
    appUserId?.let { setAccountId(obfuscateAppUserId(it)) }
    attemptId?.takeIf { it.isNotBlank() && it.length <= PLAY_OBFUSCATED_ID_MAX }?.let { setProfileId(it) }
}

/**
 * Play requires `obfuscatedAccountId` to be non-identifying and caps it at 64 chars, so the app-user id is hashed
 * rather than sent raw. Stable for a given id, which is all the server needs to correlate.
 */
internal fun obfuscateAppUserId(appUserId: String): String {
    var h1 = -0x340d631b_00000000L
    for (c in appUserId) {
        h1 = (h1 xor c.code.toLong()) * 0x100000001b3L
    }
    var h2 = 0x84222325cbf29ce4uL.toLong()
    for (c in appUserId.reversed()) {
        h2 = (h2 xor c.code.toLong()) * 0x100000001b3L
    }
    return (h1.toULong().toString(16) + h2.toULong().toString(16)).take(PLAY_OBFUSCATED_ID_MAX)
}
