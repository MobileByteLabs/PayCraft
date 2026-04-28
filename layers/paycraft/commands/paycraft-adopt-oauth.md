# paycraft-adopt-oauth — Phase 2.5: Google & Apple OAuth Setup

> **PHASE 2.5** — Configures Google/Apple OAuth on Supabase and generates
> platform-specific sign-in code in the client app.
> Run AFTER Phase 2 (Supabase migrations deployed) and BEFORE Phase 5 (verify).
> Triggered by [A] Full setup or [O] OAuth setup in the main menu.

---

## Overview

PayCraft uses OAuth as **Gate 1** for device conflict resolution (restore on new device).

```
User restores subscription on Device B
  → conflict detected → DeviceConflict state
  → UI shows: [Continue with Google] / [Continue with Apple]
  → User signs in → Supabase verifies ID token server-side → email confirmed
  → Confirmation dialog: "Deactivate [old device] and activate this one?"
  → User confirms → subscription transferred
```

OAuth is NOT used for initial purchase. It is ONLY the ownership verification
gate when a subscription is already active on another device.

**What this phase does:**
1. Enable Google/Apple providers in Supabase Auth (via Management API — no browser)
2. Collect credentials (Client IDs) and write to .env
3. Generate Android Google Sign-In code (Credential Manager) in the client app
4. Generate iOS Sign In with Apple code in the client app
5. Wire `onGoogleSignInClick` / `onAppleSignInClick` callbacks into `PayCraftRestore`
6. Mark `oauth_status` COMPLETE in memory.json

---

## STEP O.0 — Check current OAuth status

```
READ: {ENV_PATH} for:
  PAYCRAFT_GOOGLE_WEB_CLIENT_ID   (OAuth gate, Gate 1 Android)
  PAYCRAFT_APPLE_SERVICE_ID       (OAuth gate, Gate 1 iOS)

READ: {TARGET_APP_PATH}/.paycraft/memory.json → oauth_status field

QUERY Supabase Auth config:
  GET https://api.supabase.com/v1/projects/{PAYCRAFT_SUPABASE_PROJECT_REF}/config/auth
  Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}

  CHECK:
    google_enabled  = response.external_google_enabled
    apple_enabled   = response.external_apple_enabled

DISPLAY status matrix:

  ── OAuth Gate Status ─────────────────────────────────────────────
  Google  [✓ enabled | ✗ not configured]  client_id: [{short}... | (not set)]
  Apple   [✓ enabled | ✗ not configured]  service_id: [{id} | (not set)]
  ─────────────────────────────────────────────────────────────────

  [G] Setup Google   [A] Setup Apple   [B] Setup both   [S] Skip  [Q] Back

IF both already enabled AND PAYCRAFT_GOOGLE_WEB_CLIENT_ID and PAYCRAFT_APPLE_SERVICE_ID set:
  DISPLAY: "✓ OAuth already configured — checking client app wiring..."
  SKIP to STEP O.4 (verify client wiring)

WAIT: user picks option
```

---

## STEP O.1 — Google OAuth: Supabase configuration

```
DISPLAY:
  "── Google OAuth Setup ───────────────────────────────────────────"
  ""
  "You need a Google OAuth Web Client ID from Google Cloud Console."
  ""
  "How to get it (1 minute):"
  "  1. Open: https://console.cloud.google.com/apis/credentials"
  "  2. Select your project (or create one)"
  "  3. Click '+ Create Credentials' → 'OAuth client ID'"
  "  4. Application type: Web application"
  "  5. Name: 'PayCraft Supabase Auth'"
  "  6. Authorized redirect URIs: add"
  "     https://{PAYCRAFT_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback"
  "  7. Copy the Client ID (ends with .apps.googleusercontent.com)"
  ""
  "ALSO needed for Android app:"
  "  8. Create another OAuth client ID → Application type: Android"
  "     Package name: {detected from client app build.gradle.kts}"
  "     SHA-1: {prompt user to run: ./gradlew signingReport}"
  "  9. This creates the google-services.json entry — download & place in androidMain/"

WAIT: "Paste your Google Web Client ID:"
INPUT: GOOGLE_WEB_CLIENT_ID

VALIDATE: ends with ".apps.googleusercontent.com"
IF NOT: DISPLAY "⚠️  That doesn't look like a valid Google Client ID (should end with .apps.googleusercontent.com). Continue anyway? [Y/N]"

WRITE to {ENV_PATH}:
  PAYCRAFT_GOOGLE_WEB_CLIENT_ID={GOOGLE_WEB_CLIENT_ID}

PATCH Supabase Auth config via Management API:
  PATCH https://api.supabase.com/v1/projects/{PAYCRAFT_SUPABASE_PROJECT_REF}/config/auth
  Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
  Content-Type: application/json
  Body:
  {
    "external_google_enabled": true,
    "external_google_client_id": "{GOOGLE_WEB_CLIENT_ID}",
    "external_google_secret": ""
  }

IF HTTP 200:
  OUTPUT: "✓ Google OAuth enabled in Supabase Auth"
ELSE:
  DISPLAY: "✗ Failed to configure Google OAuth in Supabase: {error}"
          "Manual fallback: Dashboard → Authentication → Providers → Google → enable + paste Client ID"
  WAIT: user confirms manual step done → continue
```

---

## STEP O.2 — Apple OAuth: Supabase configuration

> Apple OAuth is required for iOS and optional for Android.
> Skip if target app is Android-only.

```
CHECK: Does the target app have iosMain/ source directory?
IF NO:
  DISPLAY: "No iosMain/ found — skipping Apple OAuth (Android-only app)"
  SKIP to STEP O.3

DISPLAY:
  "── Apple OAuth Setup ────────────────────────────────────────────"
  ""
  "You need 4 values from Apple Developer Portal."
  ""
  "How to get them (5 minutes):"
  "  1. Open: https://developer.apple.com/account/resources/identifiers"
  "  2. Register a Services ID:"
  "     Identifier: com.{yourcompany}.paycraft.signin  (or any reverse-domain)"
  "     Description: PayCraft Sign In"
  "     Enable: Sign In with Apple"
  "     → configure domain: {PAYCRAFT_SUPABASE_PROJECT_REF}.supabase.co"
  "     → return URL: https://{PAYCRAFT_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback"
  "  3. Keys → Create a Key:"
  "     Name: PayCraft Auth Key"
  "     Enable: Sign In with Apple → Configure → Primary App ID: your main app"
  "     → Download the .p8 key file"
  "     → Note the Key ID"
  "  4. Your Team ID is shown top-right in the portal"

WAIT: "Apple Services ID (e.g. com.company.paycraft.signin):"
INPUT: APPLE_SERVICE_ID

WAIT: "Apple Team ID (10-char, e.g. ABC123DEF4):"
INPUT: APPLE_TEAM_ID

WAIT: "Apple Key ID (10-char, shown on key detail page):"
INPUT: APPLE_KEY_ID

WAIT: "Paste contents of the .p8 private key file (begins with -----BEGIN PRIVATE KEY-----):"
INPUT: APPLE_PRIVATE_KEY  (multi-line — accept until user types END on its own line)

VALIDATE:
  APPLE_SERVICE_ID: contains at least one dot
  APPLE_TEAM_ID: 10 characters
  APPLE_KEY_ID: 10 characters
  APPLE_PRIVATE_KEY: contains "BEGIN PRIVATE KEY"

WRITE to {ENV_PATH}:
  PAYCRAFT_APPLE_SERVICE_ID={APPLE_SERVICE_ID}
  PAYCRAFT_APPLE_TEAM_ID={APPLE_TEAM_ID}
  PAYCRAFT_APPLE_KEY_ID={APPLE_KEY_ID}
  PAYCRAFT_APPLE_PRIVATE_KEY={APPLE_PRIVATE_KEY}

PATCH Supabase Auth config:
  PATCH https://api.supabase.com/v1/projects/{PAYCRAFT_SUPABASE_PROJECT_REF}/config/auth
  Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
  Content-Type: application/json
  Body:
  {
    "external_apple_enabled": true,
    "external_apple_client_id": "{APPLE_SERVICE_ID}",
    "external_apple_secret": "{APPLE_PRIVATE_KEY}",
    "external_apple_additional_client_ids": ""
  }

IF HTTP 200:
  OUTPUT: "✓ Apple OAuth enabled in Supabase Auth"
ELSE:
  DISPLAY: "✗ Failed to configure Apple OAuth: {error}"
          "Manual fallback: Dashboard → Authentication → Providers → Apple → enable + paste values"
  WAIT: user confirms manual step done → continue
```

---

## STEP O.3 — Android: Generate Google Sign-In code

> Uses Credential Manager (modern API, min SDK 21).
> Generates a helper class in the client app's androidMain.

```
FIND androidMain Kotlin source directory in the client app:
  SEARCH: {TARGET_APP_PATH}/**/androidMain/kotlin/**/*.kt
  EXTRACT: base package (e.g. com.sensei.social)
  EXTRACT: androidMain root (e.g. composeApp/src/androidMain/kotlin/)

IF NOT FOUND:
  ASK: "Android source directory (e.g. composeApp/src/androidMain/kotlin/):"
  VALIDATE: path exists
  ASK: "Android base package (e.g. com.sensei.social):"

DETERMINE output path:
  output_file = {androidMain_root}/{base_package_path}/paycraft/PayCraftGoogleSignIn.kt

CHECK: file already exists?
  IF YES AND contains "PayCraftGoogleSignIn":
    OUTPUT: "✓ PayCraftGoogleSignIn.kt already present — skipping"
    SKIP WRITE

ADD Credential Manager dependencies to the Android module's build.gradle.kts:
  CHECK: does androidMain.dependencies (or android { } block) contain "credentials"?
  IF NOT:
    FIND the Android module build.gradle.kts
    ADD inside androidMain.dependencies { }:
      implementation("androidx.credentials:credentials:1.3.0")
      implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
      implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    OUTPUT: "✓ Credential Manager dependencies added to androidMain"

WRITE {output_file}:
```kotlin
package {base_package}.paycraft

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Launches Google Sign-In via Credential Manager and returns the ID token.
 * Pass the token to [BillingManager.loginWithOAuth] to verify ownership.
 *
 * Usage:
 * ```
 * val idToken = PayCraftGoogleSignIn.getIdToken(context)
 * if (idToken != null) {
 *     scope.launch { billingManager.loginWithOAuth(OAuthProvider.GOOGLE, idToken) }
 * }
 * ```
 */
object PayCraftGoogleSignIn {

    suspend fun getIdToken(context: Context): String? = try {
        val credentialManager = CredentialManager.create(context)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(GOOGLE_WEB_CLIENT_ID)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
        val result = credentialManager.getCredential(context, request)
        val credential = result.credential
        if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            GoogleIdTokenCredential.createFrom(credential.data).idToken
        } else {
            null
        }
    } catch (e: Exception) {
        null
    }

    /** Web Client ID from Google Cloud Console. Loaded from PayCraftOAuthConfig. */
    private val GOOGLE_WEB_CLIENT_ID: String
        get() = PayCraftOAuthConfig.googleWebClientId
}
```

OUTPUT: "✓ PayCraftGoogleSignIn.kt written to {output_file}"

CREATE {androidMain_root}/{base_package_path}/paycraft/PayCraftOAuthConfig.kt:
```kotlin
package {base_package}.paycraft

/**
 * OAuth configuration for PayCraft device ownership verification.
 * Values are loaded from BuildConfig (or your app's config object).
 *
 * Ensure your local.properties / build.gradle.kts exposes:
 *   PAYCRAFT_GOOGLE_WEB_CLIENT_ID = "{GOOGLE_WEB_CLIENT_ID}"
 */
object PayCraftOAuthConfig {
    val googleWebClientId: String = "{PAYCRAFT_GOOGLE_WEB_CLIENT_ID}"
}
```
NOTE: Replace the hardcoded string with a BuildConfig reference if the project
      uses local.properties → BuildConfig injection. Otherwise the value is
      baked in at compile time (acceptable for this use case).

OUTPUT: "✓ PayCraftOAuthConfig.kt written"
```

---

## STEP O.4 — iOS: Generate Sign In with Apple code

```
FIND iosMain Kotlin source directory:
  SEARCH: {TARGET_APP_PATH}/**/iosMain/kotlin/**/*.kt
  EXTRACT: iosMain root + base package

IF NOT FOUND:
  DISPLAY: "No iosMain Kotlin sources found — skipping iOS Apple Sign-In"
  SKIP to STEP O.5

DETERMINE output path:
  output_file = {iosMain_root}/{base_package_path}/paycraft/PayCraftAppleSignIn.kt

CHECK: file already exists?
  IF YES AND contains "PayCraftAppleSignIn": OUTPUT "✓ already present" → SKIP WRITE

WRITE {output_file}:
```kotlin
package {base_package}.paycraft

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.AuthenticationServices.ASAuthorization
import platform.AuthenticationServices.ASAuthorizationAppleIDCredential
import platform.AuthenticationServices.ASAuthorizationAppleIDProvider
import platform.AuthenticationServices.ASAuthorizationController
import platform.AuthenticationServices.ASAuthorizationControllerDelegateProtocol
import platform.AuthenticationServices.ASAuthorizationControllerPresentationContextProvidingProtocol
import platform.AuthenticationServices.ASAuthorizationScopeEmail
import platform.AuthenticationServices.ASPresentationAnchor
import platform.Foundation.NSError
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.UIKit.UIApplication
import platform.darwin.NSObject
import kotlin.coroutines.resume

/**
 * Launches Sign In with Apple and returns the ID token string.
 * Pass the token to [BillingManager.loginWithOAuth] to verify ownership.
 *
 * Usage:
 * ```
 * val idToken = PayCraftAppleSignIn.getIdToken()
 * if (idToken != null) {
 *     scope.launch { billingManager.loginWithOAuth(OAuthProvider.APPLE, idToken) }
 * }
 * ```
 *
 * Requires: Sign In with Apple capability in Xcode project.
 */
object PayCraftAppleSignIn {

    suspend fun getIdToken(): String? = suspendCancellableCoroutine { cont ->
        val provider = ASAuthorizationAppleIDProvider()
        val request = provider.createRequest().apply {
            requestedScopes = listOf(ASAuthorizationScopeEmail)
        }
        val controller = ASAuthorizationController(
            authorizationRequests = listOf(request),
        )
        val delegate = Delegate(cont)
        controller.delegate = delegate
        controller.presentationContextProvider = delegate
        controller.performRequests()

        cont.invokeOnCancellation { controller.delegate = null }
    }

    private class Delegate(
        private val cont: CancellableContinuation<String?>,
    ) : NSObject(),
        ASAuthorizationControllerDelegateProtocol,
        ASAuthorizationControllerPresentationContextProvidingProtocol {

        override fun authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithAuthorization: ASAuthorization,
        ) {
            val credential = didCompleteWithAuthorization.credential
                as? ASAuthorizationAppleIDCredential
            val tokenData = credential?.identityToken ?: run {
                cont.resume(null)
                return
            }
            val idToken = NSString.create(tokenData, NSUTF8StringEncoding) as? String
            cont.resume(idToken)
        }

        override fun authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithError: NSError,
        ) {
            cont.resume(null)
        }

        override fun presentationAnchorForAuthorizationController(
            controller: ASAuthorizationController,
        ): ASPresentationAnchor {
            return UIApplication.sharedApplication.keyWindow!!
        }
    }
}
```

OUTPUT: "✓ PayCraftAppleSignIn.kt written to {output_file}"

NOTE:
  DISPLAY:
    "⚠️  Xcode step required (manual — 30 seconds):"
    "  1. Open the Xcode project for your iOS target"
    "  2. Select the target → Signing & Capabilities"
    "  3. Click '+' → Sign In with Apple"
    "  4. This adds the entitlement automatically — no code change needed"
    ""
    "Press [Y] when the Sign In with Apple capability is added."
  WAIT: user presses Y
```

---

## STEP O.5 — Wire callbacks in client app (commonMain)

> Find where `PayCraftRestore` is used in the client app and add the OAuth callbacks.
> This is the ONLY change that goes in commonMain — everything else is platform-specific.

```
SEARCH in {TARGET_APP_PATH}/**/commonMain/**/*.kt for "PayCraftRestore("
RESULTS: list of files

IF NOT FOUND:
  DISPLAY: "PayCraftRestore not found in commonMain. Wire manually:"
  SHOW code snippet (see below)
  WAIT: user confirms [Y]
  MARK as manual
  SKIP to STEP O.6

FOR EACH file found:
  READ: file content
  FIND: the PayCraftRestore( ... ) call block

  CHECK: already has onGoogleSignInClick or onAppleSignInClick?
  IF YES:
    OUTPUT: "✓ {file} already has OAuth callbacks — no change"
    SKIP this file

  CHECK: is androidMain present? → set HAS_ANDROID = true
  CHECK: is iosMain present?     → set HAS_IOS = true

  ADD required imports at top of file (if not already present):
```
import kotlinx.coroutines.launch
// Android only (added at runtime in androidMain — commonMain uses expect/actual):
// For commonMain: use remember { mutableStateOf(false) } for loading state
```

  FIND: the PayCraftRestore( ... ) call in the file
  TRANSFORM from:
```kotlin
PayCraftRestore(
    visible = {expr},
    onDismiss = {expr},
)
```
  TO:
```kotlin
val scope = rememberCoroutineScope()
// context is only available in androidMain — use expect/actual or LocalContext
// See PayCraftGoogleSignIn.kt in androidMain and PayCraftAppleSignIn.kt in iosMain

PayCraftRestore(
    visible = {expr},
    onDismiss = {expr},
    onGoogleSignInClick = if ({HAS_ANDROID}) {
        {
            scope.launch {
                val idToken = PayCraftGoogleSignIn.getIdToken(/* context = */ TODO("Pass LocalContext.current"))
                if (idToken != null) {
                    billingManager.loginWithOAuth(OAuthProvider.GOOGLE, idToken)
                }
            }
        }
    } else null,
    onAppleSignInClick = if ({HAS_IOS}) {
        {
            scope.launch {
                val idToken = PayCraftAppleSignIn.getIdToken()
                if (idToken != null) {
                    billingManager.loginWithOAuth(OAuthProvider.APPLE, idToken)
                }
            }
        }
    } else null,
)
```

NOTE:
  IF the file is in commonMain and uses LocalContext (Android-only API):
    The `PayCraftGoogleSignIn.getIdToken(context)` call requires Android Context.
    PATTERN: Create an expect/actual wrapper:

    commonMain:
    ```kotlin
    expect suspend fun launchGoogleSignIn(): String?
    ```

    androidMain:
    ```kotlin
    import {base_package}.paycraft.PayCraftGoogleSignIn
    actual suspend fun launchGoogleSignIn(): String? =
        PayCraftGoogleSignIn.getIdToken(androidContext())
        // androidContext() from Koin or pass via LocalContext.current
    ```

    iosMain:
    ```kotlin
    actual suspend fun launchGoogleSignIn(): String? = null  // Google not used on iOS
    ```

  THEN in commonMain:
    ```kotlin
    onGoogleSignInClick = {
        scope.launch {
            val idToken = launchGoogleSignIn()
            if (idToken != null) {
                billingManager.loginWithOAuth(OAuthProvider.GOOGLE, idToken)
            }
        }
    },
    ```

VERIFY: Re-read each modified file → confirm callbacks present
IF MISSING: HARD STOP — "Failed to write OAuth callbacks to {file}"

OUTPUT: "✓ OAuth callbacks wired in {file}"
```

---

## STEP O.6 — Add required imports to PayCraftConfig or config file

```
FIND PayCraftConfig.kt (from memory.json → configure_file)

ADD to the configure block (inside PayCraft.configure { ... }):
  This doesn't change — OAuth works at the BillingManager level, not configure().
  No change to PayCraft.configure() needed.

VERIFY Supabase OAuth config is live:
  GET https://api.supabase.com/v1/projects/{PAYCRAFT_SUPABASE_PROJECT_REF}/config/auth
  Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}

  CHECK:
    external_google_enabled = true  (if Google was configured)
    external_apple_enabled  = true  (if Apple was configured)

IF checks pass:
  OUTPUT: "✓ Supabase Auth OAuth providers verified live"
ELSE:
  DISPLAY: "⚠️  Supabase OAuth not yet showing as enabled — may take 30 seconds to propagate"
           "[R] Retry   [S] Skip"
```

---

## STEP O.7 — Update memory.json

```
READ: {TARGET_APP_PATH}/.paycraft/memory.json
UPDATE:
  oauth_status: "COMPLETE"
  google_oauth_configured: true  (if Google was configured this run)
  apple_oauth_configured: true   (if Apple was configured this run)
  last_run: now (ISO8601 UTC)
  phases_completed: append "oauth" if not already present

WRITE (atomic: .tmp → rename)
OUTPUT: "✓ memory.json updated: oauth_status = COMPLETE"
```

---

## STEP O.8 — Phase summary

```
DISPLAY:
  "╔══ Phase 2.5 Complete: OAuth Setup ══════════════════════════════╗"
  "║                                                                  ║"
  "║  ✓ Supabase Auth: Google provider enabled                       ║"  ← if configured
  "║  ✓ Supabase Auth: Apple provider enabled                        ║"  ← if configured
  "║  ✓ PayCraftGoogleSignIn.kt generated (androidMain)              ║"  ← if generated
  "║  ✓ PayCraftAppleSignIn.kt generated (iosMain)                   ║"  ← if generated
  "║  ✓ PayCraftRestore callbacks wired (commonMain)                 ║"
  "║                                                                  ║"
  "║  How it works at runtime:                                       ║"
  "║    1. User tries to restore on new device → conflict detected   ║"
  "║    2. Conflict UI shows [Continue with Google / Apple]          ║"
  "║    3. User taps → platform OAuth flow → ID token obtained       ║"
  "║    4. Token passed to billingManager.loginWithOAuth()           ║"
  "║    5. Supabase verifies token server-side → email confirmed     ║"
  "║    6. Dialog: 'Deactivate [old device] and activate this one?'  ║"
  "║    7. Confirm → transferToDevice() → subscription moved         ║"
  "║                                                                  ║"
  "║  OTP fallback (Gate 2) for custom-domain emails:               ║"
  "║    User taps 'Send code to email' → Brevo OTP → verify → same  ║"
  "║                                                                  ║"
  "╚══════════════════════════════════════════════════════════════════╝"
```

---

## Auto-verify gates (used by STEP 0C in paycraft-adopt.md)

When the auto-verify loop checks OAuth status, it validates:

```
GATE OAUTH.1 — Supabase Google provider enabled
  GET /v1/projects/{ref}/config/auth → external_google_enabled = true
  ALREADY_DONE if true
  AUTO_FIX: PATCH external_google_enabled=true (requires PAYCRAFT_GOOGLE_WEB_CLIENT_ID in .env)
  MANUAL_REQUIRED if PAYCRAFT_GOOGLE_WEB_CLIENT_ID not in .env

GATE OAUTH.2 — Supabase Apple provider enabled
  GET /v1/projects/{ref}/config/auth → external_apple_enabled = true
  ALREADY_DONE if true
  AUTO_FIX: PATCH external_apple_enabled=true (requires APPLE_* keys in .env)
  MANUAL_REQUIRED if keys missing

GATE OAUTH.3 — Android Google Sign-In code present
  Glob {TARGET_APP_PATH}/**/androidMain/**/*GoogleSignIn*.kt
  ALREADY_DONE if found
  AUTO_FIX: generate (STEP O.3)

GATE OAUTH.4 — iOS Apple Sign-In code present
  Glob {TARGET_APP_PATH}/**/iosMain/**/*AppleSignIn*.kt
  ALREADY_DONE if found (or no iosMain exists → skip)
  AUTO_FIX: generate (STEP O.4)

GATE OAUTH.5 — PayCraftRestore has OAuth callbacks
  Grep {TARGET_APP_PATH}/**/commonMain/**/*.kt for "onGoogleSignInClick"
  ALREADY_DONE if found
  AUTO_FIX: wire callbacks (STEP O.5)
  MANUAL_REQUIRED if PayCraftRestore not found
```
