package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.identity.ConsumerAuth
import com.mobilebytelabs.paycraft.core.identity.ConsumerUser
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Buyers sign in through the APP's own Supabase: hand PayCraft the app's kmp-supabase-auth client — the one
 * installed on its existing Supabase client, never a second one (a second client carries no session).
 *
 * ```
 * PayCraft.initialize(apiKey = "pk_…")
 * PayCraft.useConsumerAuth(kmpSupabaseAuthClient)
 * ```
 *
 * A signed-in app user is then linked silently; PayCraft's restore / device-conflict / link screens sign in
 * with the app's Google and Apple (native where the platform has it, in-app browser otherwise).
 */
fun PayCraft.useConsumerAuth(client: KmpSupabaseAuthClient) {
    ConsumerSupabaseAuth.client = client
    useConsumerAuth(KmpSupabaseConsumerAuth(client))
}

/** The app's client, kept for the sign-in launchers (Compose-scoped, so they cannot live in core). */
internal object ConsumerSupabaseAuth {
    var client: KmpSupabaseAuthClient? = null
}

internal class KmpSupabaseConsumerAuth(private val client: KmpSupabaseAuthClient) : ConsumerAuth {
    override val user: Flow<ConsumerUser?> =
        client.currentUser.map { u -> u?.let { ConsumerUser(it.id, it.email, it.isAnonymous) } }

    override fun accessToken(): String? = client.currentAccessToken()
}
