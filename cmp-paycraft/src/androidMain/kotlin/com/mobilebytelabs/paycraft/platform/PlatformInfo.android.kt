package com.mobilebytelabs.paycraft.platform

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

actual object PlatformInfo {
    private const val DEBUG_KEYSTORE_CN = "CN=Android Debug"

    actual val platform: String = "android"
    actual val deviceName: String
        get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    actual val deviceId: String
        get() = DeviceTokenStore.applicationContext?.let { ctx ->
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } ?: "android-unknown"

    // Billing region follows the SIM/network country (the signal Google Play itself uses),
    // NOT the language locale — a user whose phone language is English (UK) but whose SIM is
    // Indian must bill in ₹, not £. Falls back to the language-locale region only when there's
    // no SIM/network (e.g. a wifi-only tablet). simCountryIso/networkCountryIso are permission-free.
    // ── Build kind, from the APK's SIGNING CERTIFICATE ────────────────────────────────────────
    //
    // Every Android debug build is signed by the debug keystore the SDK tooling generates, whose
    // certificate subject is the fixed `CN=Android Debug, O=Android, C=US`. No distribution build
    // carries it — Play upload/signing keys are the developer's own. The signature is therefore a
    // property of HOW THE ARTIFACT WAS PRODUCED, which is what we need and what no flag reliably
    // reports.
    //
    // This replaces `ApplicationInfo.FLAG_DEBUGGABLE`, which answers "may a debugger attach?" and
    // not "is this a development build". A RELEASE build with `debuggable true` (routine when
    // profiling, or chasing a production-only crash) reads debuggable — under the old code it would
    // have been handed the TEST key and silently stopped taking real payments. A signature cannot
    // be confused that way.
    //
    // No Context → Unknown, never Release. The old `?: false` turned a startup race (Koin resolving
    // PayCraft before androidx-startup wires the Context) into a confident "release"; PayCraftApiImpl
    // documents that exact race biting on device. Unknown is visible, a confident wrong answer is not.
    private data class Verdict(val kind: BuildKind, val evidence: String)

    private val verdict: Verdict
        get() {
            val ctx = DeviceTokenStore.applicationContext
                ?: return Verdict(BuildKind.Unknown, "android:no-application-context")
            return runCatching {
                val subjects = signingCertificateSubjects(ctx)
                when {
                    subjects.isEmpty() ->
                        Verdict(BuildKind.Unknown, "android:no-signing-certificate")
                    subjects.any { it.contains(DEBUG_KEYSTORE_CN, ignoreCase = true) } ->
                        Verdict(BuildKind.Debug, "android:debug-keystore-signature")
                    else ->
                        Verdict(BuildKind.Release, "android:release-signature")
                }
            }.getOrElse { Verdict(BuildKind.Unknown, "android:signature-read-failed") }
        }

    @Suppress("DEPRECATION")
    private fun signingCertificateSubjects(ctx: Context): List<String> {
        val pm = ctx.packageManager
        val pkg = ctx.packageName
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
            // apkContentsSigners is the CURRENT signer set. signingCertificateHistory would include
            // rotated-away certificates and could report a long-retired debug signer on a live app.
            info.signingInfo?.apkContentsSigners
        } else {
            pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
        }.orEmpty()

        return signatures.mapNotNull { sig ->
            runCatching {
                val cert = CertificateFactory.getInstance("X.509")
                    .generateCertificate(sig.toByteArray().inputStream()) as X509Certificate
                cert.subjectX500Principal.name
            }.getOrNull()
        }
    }

    actual val buildKind: BuildKind get() = verdict.kind
    actual val buildKindEvidence: String get() = verdict.evidence
    actual val isDebugBuild: Boolean get() = buildKind == BuildKind.Debug

    actual val country: String?
        get() = simOrNetworkCountry()
            ?: java.util.Locale.getDefault().country.takeIf { it.isNotBlank() }
}

private fun simOrNetworkCountry(): String? {
    val ctx = DeviceTokenStore.applicationContext ?: return null
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return null
    // SIM country is most authoritative for billing; network country covers roaming/eSIM gaps.
    return (tm.simCountryIso?.takeIf { it.isNotBlank() } ?: tm.networkCountryIso?.takeIf { it.isNotBlank() })
        ?.uppercase()
}
