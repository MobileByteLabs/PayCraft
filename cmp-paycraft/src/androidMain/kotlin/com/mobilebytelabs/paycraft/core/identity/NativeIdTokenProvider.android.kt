package com.mobilebytelabs.paycraft.core.identity

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftPlatform
import com.mobilebytelabs.paycraft.model.OAuthProvider

/** Google via Credential Manager with the app's Web client as `serverClientId`. Apple → browser. */
internal actual object NativeIdTokenProvider {
    actual suspend fun idToken(provider: OAuthProvider, rawNonce: String): NativeTokenResult {
        if (provider != OAuthProvider.GOOGLE) return NativeTokenResult.Unavailable
        val webClientId = PayCraft.suiteConfig?.auth?.googleWebClientId?.takeIf { it.isNotBlank() }
            ?: return NativeTokenResult.Unavailable
        // Credential Manager needs an Activity context to show its sheet.
        val activity = PayCraftPlatform.currentActivityOrNull() ?: return NativeTokenResult.Unavailable
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(
                GetGoogleIdOption.Builder()
                    .setServerClientId(webClientId)
                    .setFilterByAuthorizedAccounts(false)
                    .setNonce(rawNonce)
                    .build(),
            )
            .build()
        return try {
            val credential = CredentialManager.create(activity).getCredential(activity, request).credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                NativeTokenResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                NativeTokenResult.Failed("unexpected credential ${credential.type}")
            }
        } catch (_: GetCredentialCancellationException) {
            NativeTokenResult.Cancelled
        } catch (_: NoCredentialException) {
            // No Google account on the device (or Play services can't offer one) — the browser can.
            NativeTokenResult.Unavailable
        } catch (e: GetCredentialException) {
            NativeTokenResult.Failed(e.message)
        }
    }
}
