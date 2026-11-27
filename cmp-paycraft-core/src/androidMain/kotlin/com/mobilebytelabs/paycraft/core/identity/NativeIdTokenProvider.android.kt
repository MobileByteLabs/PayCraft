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
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.OAuthProvider

/** Google via Credential Manager with the app's Web client as `serverClientId`. Apple → browser. */
internal actual object NativeIdTokenProvider {
    actual suspend fun idToken(provider: OAuthProvider, rawNonce: String): NativeTokenResult {
        if (provider != OAuthProvider.GOOGLE) return NativeTokenResult.Unavailable
        val webClientId = PayCraft.suiteConfig?.auth?.googleWebClientId?.takeIf { it.isNotBlank() }
            ?: return skipped("no Google web client id in the suite config")
        // Credential Manager needs an Activity context to show its sheet.
        val activity = PayCraftPlatform.currentActivityOrNull() ?: return skipped("no foreground Activity")
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
        } catch (e: NoCredentialException) {
            // No Google account the provider can offer (none on the device, or Google is not an enabled
            // credential provider) — the browser can.
            skipped("NoCredentialException: ${e.message}")
        } catch (e: GetCredentialException) {
            NativeTokenResult.Failed(e.message)
        }
    }

    /** Native sign-in is skipped, not failed — say why, since the caller moves on to the browser. */
    private fun skipped(reason: String): NativeTokenResult {
        PayCraftLogger.onError("signIn", "native google unavailable, falling back to browser: $reason")
        return NativeTokenResult.Unavailable
    }
}
