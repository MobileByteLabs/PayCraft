import java.io.File

/** Writes `MIGRATION_DASHBOARD_CHECKLIST.md` from the detected migration entries. */
class PayCraftMigrationChecklistEmitter {

    fun emit(entries: List<MigrationEntry>, file: File) {
        val sb = StringBuilder()
        sb.appendLine("# PayCraft v2 Migration — Dashboard Configuration Checklist")
        sb.appendLine()
        sb.appendLine("After running `./gradlew paycraftMigrateV2 --apply`, complete the following steps")
        sb.appendLine("in the PayCraft Dashboard at https://paycraft.cloud:")
        sb.appendLine()
        sb.appendLine("## 1. Sign up + create an app")
        sb.appendLine("Go to https://paycraft.cloud/auth/signup, name your app, copy your test + live API keys.")
        sb.appendLine("Paste them into the migrated `PayCraft.initialize(apiKey = ...)` calls.")
        sb.appendLine()
        sb.appendLine("## 2. Connect providers")
        val allProviders = entries.flatMap { it.providers }.distinct()
        if (allProviders.isEmpty()) {
            sb.appendLine("- [ ] Connect at least one payment provider (Stripe / Razorpay / PayPal)")
        } else {
            allProviders.forEach { sb.appendLine("- [ ] $it") }
        }
        sb.appendLine()
        sb.appendLine("## 3. Re-create products")
        val allSkus = entries.flatMap { it.planSkus }.distinct()
        if (allSkus.isEmpty()) {
            sb.appendLine("- [ ] Create your subscription / trial / lifetime products")
        } else {
            allSkus.forEach { sb.appendLine("- [ ] $it") }
        }
        sb.appendLine()
        sb.appendLine("## 4. Configure paywall design")
        sb.appendLine("- [ ] Pick template (Minimal / Premium / Dark)")
        sb.appendLine("- [ ] Set primary color + font")
        sb.appendLine("- [ ] Branding tier (Attribution / None / Custom)")
        sb.appendLine()
        sb.appendLine("## 5. Webhook setup")
        sb.appendLine("Visit /webhooks in the dashboard for the per-provider URLs to register.")
        sb.appendLine()
        sb.appendLine("## 6. Verify")
        sb.appendLine("Rebuild your app — the paywall should appear unchanged for the new tenant.")
        sb.appendLine()
        sb.appendLine("---")
        sb.appendLine("Files migrated:")
        entries.distinctBy { it.file }.forEach { sb.appendLine("- ${it.file}") }
        file.writeText(sb.toString())
    }
}
