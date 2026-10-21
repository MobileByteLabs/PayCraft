/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.InitOptions
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.core.ConsumableDrainer
import com.mobilebytelabs.paycraft.core.ConsumableGrantSink
import com.mobilebytelabs.paycraft.core.MonetizationMode
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.koin.core.module.Module
import org.koin.core.scope.Scope
import org.koin.dsl.module
import kotlin.random.Random
import kotlin.time.Clock

/**
 * The ONE call that wires PayCraft into a consumer app.
 *
 * ```kotlin
 * // core/network/.../di/ProjectNetworkModule.kt
 * val ProjectNetworkModule = module {
 *     includes(
 *         payCraft(
 *             apiKey = BuildKonfig.PAYCRAFT_PUBLISHABLE_KEY,
 *             testApiKey = BuildKonfig.PAYCRAFT_TEST_KEY,
 *             identity = { get<AuthRepository>().session.map { it.user?.email } },
 *         ),
 *     )
 * }
 * ```
 *
 * That is the whole integration. Everything below — initialization ORDER, the coroutine scope, the
 * lazy repository lookup, de-duplicating the identity stream, filtering blanks — is the SDK's.
 *
 * ## What this replaces, and why it had to move
 *
 * Consumers were writing a `PayCraftBootstrap` class of their own: ~74 lines whose entire content
 * was SDK-shaped glue. Measured on `mbs/cappy` before this existed, a correct one had to know
 * three non-obvious things, none of which belong in an app:
 *
 *  1. `PayCraft.initialize` must run BEFORE `startKoin` resolves anything, because
 *     `PayCraftModule`'s `SupabaseClient` and `PayCraftService` singletons read `PayCraft.backend`
 *     and `PayCraft.apiKey` at construction.
 *  2. The repository therefore cannot be a constructor parameter of the thing that initializes —
 *     it does not exist yet. It has to be resolved LAZILY, per call, inside a lambda.
 *  3. The binder must be `createdAtStart = true`, or "the SDK is up before the first entitlement
 *     read" silently depends on some other singleton happening to resolve it first.
 *
 * Every consumer rediscovering those is three chances to get billing initialization subtly wrong,
 * in a way that compiles and mostly works. They are invariants of the SDK, so the SDK holds them.
 *
 * ## The two things that remain the consumer's
 *
 * There are exactly two, and they are the parameters of this function:
 *
 *  - **WHICH KEYS** — only the app knows its own build config.
 *  - **WHO THE USER IS** — the SDK cannot know the app's auth session.
 *
 * @param apiKey the publishable key (`pk_live_…`). Public, committable, NOT vault material.
 * @param testApiKey the test key (`pk_test_…`), if the app has one. Hand over BOTH and let the SDK
 *   pick by build kind — an app-side "use test billing" flag is how a debug build ends up shipping
 *   the live key and taking real money (FAILURE_MODES F35). Blank or null means "no test key".
 * @param backend [PayCraftBackend.Cloud] unless the tenant self-hosts, or [PayCraftBackend.Mock]
 *   for tests and offline previews.
 * @param identity resolves the signed-in email from the app's own auth, inside the Koin scope so
 *   it can `get()` whatever that app uses. Defaults to none: an app with no accounts is entitled
 *   by device alone and needs no identity at all. The SDK only ever wants the address — never a
 *   user object, and never a password or token.
 */
fun payCraft(
    apiKey: String,
    testApiKey: String? = null,
    backend: PayCraftBackend = PayCraftBackend.Cloud,
    options: InitOptions = InitOptions(),
    mode: MonetizationMode = MonetizationMode.AdSupported,
    identity: Scope.() -> Flow<String?> = { emptyFlow() },
    /**
     * WHERE PURCHASED UNITS GO. Bound once, like [identity], and then the SDK handles the rest:
     * which products are consumable, noticing a balance, debiting it server-side with a
     * caller-owned idempotency key, and replaying after a crash. The host states only how to credit
     * its OWN ledger, and must do so idempotently on `grantId` — it can be called again.
     *
     * A `Scope.() -> …` for the same reason [identity] is one: the credit lands in the host's OWN
     * storage, so the lambda has to be able to `get()` the host's database or repository. Typing it
     * as a bare sink made `get` unresolvable at the call site — it resolved against whatever `get`
     * happened to be in scope, which in the first consumer was `MatchGroupCollection.get`.
     *
     * Omit it and nothing drains: a host with no consumables pays nothing for this.
     */
    onUnitsGranted: (Scope.() -> ConsumableGrantSink)? = null,
): Module = module {
    includes(PayCraftModule)

    // createdAtStart, and that is load-bearing: see (3) in the kdoc above.
    single(createdAtStart = true) {
        PayCraftIdentityBinder(
            // Resolved HERE, in the Koin scope, so a consumer's `identity` lambda can `get()` its
            // own auth repository without this function knowing that type exists.
            email = identity(),
            // A lambda, not a value: the SDK's own definitions only become resolvable once
            // `initialize` has run, which happens inside the binder's constructor below. See (2).
            repository = { getKoin().getOrNull<PayCraftRepository>() },
            // Same lambda shape and same reason: the SDK's own definitions only resolve once
            // `initialize` has run, which happens inside the binder's constructor.
            store = { getKoin().getOrNull<PayCraftStore>() },
            apiKey = apiKey,
            testApiKey = testApiKey,
            backend = backend,
            options = options,
            mode = mode,
            onUnitsGranted = onUnitsGranted?.invoke(this),
        )
    }
}

/**
 * Initializes the SDK and keeps its identity pointed at the signed-in user.
 *
 * Internal: a consumer reaches this through [payCraft] and never names it. It is a class rather
 * than a block inside the module so the ordering contract has somewhere to live and be tested.
 */
internal class PayCraftIdentityBinder(
    email: Flow<String?>,
    repository: () -> PayCraftRepository?,
    store: () -> PayCraftStore?,
    apiKey: String,
    testApiKey: String?,
    backend: PayCraftBackend,
    options: InitOptions,
    mode: MonetizationMode,
    onUnitsGranted: ConsumableGrantSink? = null,
    scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    init {
        // FIRST, synchronously, before anything can resolve a PayCraft singleton. See (1).
        PayCraft.initialize(
            apiKey = apiKey,
            backend = backend,
            options = options,
            mode = mode,
            testApiKey = testApiKey?.takeIf { it.isNotBlank() },
        )

        scope.launch {
            email
                .map { it?.trim().orEmpty() }
                // distinctUntilChanged: a session Flow re-emits on every token refresh, and
                // logging the same user in repeatedly would re-register the device each time.
                .distinctUntilChanged()
                // Bind on EVERY change, not once. A sign-out followed by a sign-in as somebody
                // else must re-point the entitlement, or the second user inherits the first's
                // subscription. The blank check covers sign-OUT, where the SDK keeps its last
                // identity rather than being told the user is "".
                .collect { address -> if (address.isNotBlank()) repository()?.logIn(address) }
        }

        // Collect anything bought since last launch. A purchase credits the SERVER balance via the
        // store/PSP webhook, which can land while the app is closed or on another device — so this
        // cannot hang off a purchase callback and runs at start instead. Idempotent and cheap when
        // there is nothing outstanding.
        if (onUnitsGranted != null) {
            scope.launch {
                val repo = repository() ?: return@launch
                val persisted = store() ?: return@launch
                ConsumableDrainer(
                    repository = repo,
                    store = persisted,
                    sink = onUnitsGranted,
                    // Unique per drain, and that matters in BOTH directions: a COLLIDING id would be
                    // absorbed by the server's idempotency key and the grant silently lost, while a
                    // RE-ROLLED id for an interrupted grant would credit it twice. Uniqueness here,
                    // stability across a resume via the persisted intent.
                    newGrantId = {
                        "grant-" + Clock.System.now().toEpochMilliseconds() + "-" +
                            Random.nextInt(Int.MAX_VALUE)
                    },
                ).drain()
            }
        }
    }
}
