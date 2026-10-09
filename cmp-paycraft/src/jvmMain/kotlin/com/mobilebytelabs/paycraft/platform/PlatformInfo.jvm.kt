package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "desktop"
    actual val deviceName: String
        get() = "${System.getProperty("os.name")} (${System.getProperty("user.name")})"
    actual val deviceId: String
        get() = loadOrCreateJvmDeviceId()
    actual val country: String?
        get() = java.util.Locale.getDefault().country.takeIf { it.isNotBlank() }

    // ── Build kind, from PACKAGING identity ───────────────────────────────────────────────────
    //
    // A shipped desktop app is a jpackage app-image (.app / .exe / .deb): its code loads from a jar
    // under that image. Development runs load from `build/classes`, which no distribution contains.
    // Packaging is how a desktop app ships, so it is the honest structural signal — the JVM has no
    // signature to read the way Android and iOS do.
    //
    // JDWP is checked FIRST but only as a positive: an attached debugger definitively means
    // development. Its ABSENCE proves nothing, which is the bug in the previous implementation —
    // `./gradlew run` without a debugger reported "release" and, with two keys configured, would
    // have handed a developer the LIVE credential.
    //
    // Everything unrecognised is Unknown, never Release.
    private val verdict: Pair<BuildKind, String>
        get() = runCatching {
            val jdwp = java.lang.management.ManagementFactory.getRuntimeMXBean()
                .inputArguments.any { it.contains("jdwp", ignoreCase = true) }
            if (jdwp) return@runCatching BuildKind.Debug to "jvm:jdwp-agent-attached"

            val location = PlatformInfo::class.java.protectionDomain?.codeSource?.location?.path
            when {
                location == null -> BuildKind.Unknown to "jvm:no-code-source"
                // Running from compiled classes on disk — a build tree, not a distribution.
                location.contains("/build/classes/") || location.contains("\\build\\classes\\") ->
                    BuildKind.Debug to "jvm:running-from-build-classes"
                location.contains("/build/install/") || location.contains("/build/compose/") ->
                    BuildKind.Debug to "jvm:running-from-build-output"
                location.endsWith(".jar") -> BuildKind.Release to "jvm:packaged-jar"
                else -> BuildKind.Unknown to "jvm:unrecognised-code-source"
            }
        }.getOrElse { BuildKind.Unknown to "jvm:code-source-read-failed" }

    actual val buildKind: BuildKind get() = verdict.first
    actual val buildKindEvidence: String get() = verdict.second
    actual val isDebugBuild: Boolean get() = buildKind == BuildKind.Debug
}

private fun loadOrCreateJvmDeviceId(): String {
    val file = java.io.File(System.getProperty("user.home"), ".paycraft/device_id")
    if (file.exists()) return file.readText().trim()
    val id = java.util.UUID.randomUUID().toString()
    file.parentFile.mkdirs()
    file.writeText(id)
    return id
}
