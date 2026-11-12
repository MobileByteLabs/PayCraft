package com.mobilebytelabs.paycraft.billing

/**
 * StoreKit requires `appAccountToken` to be a UUID, but the SDK's app-user id is an email or a
 * device id. Derive a stable UUID-shaped token from it so the same buyer always produces the same
 * token and the server-side notification can attribute the transaction. Shared (not iOS-only) because the
 * `winback` function must sign an App Store promotional offer over the SAME token the purchase will send.
 */
internal fun storeAppAccountToken(appUserId: String): String {
    var h1 = -0x340d631b00000000L
    var h2 = 0x2545f4914f6cdd1dL
    for (c in appUserId) {
        h1 = (h1 xor c.code.toLong()) * 0x100000001b3L
        h2 = (h2 + c.code.toLong()) * 0x27220a95L
    }
    val a = h1.toULong().toString(16).padStart(16, '0')
    val b = h2.toULong().toString(16).padStart(16, '0')
    return "${a.substring(0, 8)}-${a.substring(8, 12)}-${a.substring(12, 16)}-" +
        "${b.substring(0, 4)}-${b.substring(4, 16)}"
}
