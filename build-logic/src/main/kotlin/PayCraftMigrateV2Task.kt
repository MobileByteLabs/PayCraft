import org.gradle.api.DefaultTask
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.TaskAction

abstract class PayCraftMigrateV2Task : DefaultTask() {

    @get:Input @get:Optional
    abstract val apply: Property<Boolean>

    @get:Input @get:Optional
    abstract val reason: Property<String>

    @TaskAction
    fun run() {
        val applyChanges = apply.getOrElse(false)
        val backupRoot = project.layout.projectDirectory.dir(".paycraft-backup").asFile
        val sources = project.fileTree(project.projectDir) {
            include("**/*.kt")
            exclude("**/build/**", "**/.paycraft-backup/**")
        }

        val parser = PayCraftConfigBlockParser()
        val rewriter = PayCraftSuiteRewriter()
        val emitter = PayCraftMigrationChecklistEmitter()
        val allEntries = mutableListOf<MigrationEntry>()
        var detected = 0
        var rewritten = 0

        sources.forEach { file ->
            val source = file.readText()
            val matches = parser.findConfigureBlocks(source)
            if (matches.isEmpty()) return@forEach
            detected += matches.size
            val entries = parser.extractEntries(matches, file)
            allEntries += entries

            if (applyChanges) {
                val rel = project.projectDir.toPath().relativize(file.toPath())
                val backupFile = backupRoot.resolve(rel.toString())
                backupFile.parentFile.mkdirs()
                file.copyTo(backupFile, overwrite = true)
                file.writeText(rewriter.rewrite(source, matches))
                rewritten++
            }
        }

        if (allEntries.isNotEmpty()) {
            val checklist = project.projectDir.resolve("MIGRATION_DASHBOARD_CHECKLIST.md")
            emitter.emit(allEntries, checklist)
            logger.lifecycle("  → wrote ${checklist.relativeTo(project.projectDir)}")
        }

        val mode = if (applyChanges) "applied" else "dry-run — pass -Papply=true to write"
        logger.lifecycle("PayCraft dashboard adopt — detected $detected configure{} blocks, rewritten $rewritten ($mode)")

        if (!applyChanges && detected > 0) {
            logger.lifecycle("Run with -Papply=true to rewrite ${detected} file(s) and emit MIGRATION_DASHBOARD_CHECKLIST.md")
        }
    }
}
