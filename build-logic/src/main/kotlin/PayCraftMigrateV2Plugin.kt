import org.gradle.api.Plugin
import org.gradle.api.Project

class PayCraftMigrateV2Plugin : Plugin<Project> {
    override fun apply(target: Project) {
        target.tasks.register("paycraftMigrateV2", PayCraftMigrateV2Task::class.java) {
            group = "paycraft"
            description = "Switch in-code PayCraft.configure {} to cloud dashboard configuration. " +
                "Pass -Papply=true to write changes and emit MIGRATION_DASHBOARD_CHECKLIST.md."

            // Wire Gradle project properties to task inputs
            if (target.hasProperty("apply")) {
                apply.set(target.property("apply").toString().toBooleanStrictOrNull() ?: false)
            }
            if (target.hasProperty("reason")) {
                reason.set(target.property("reason").toString())
            }
        }
    }
}
