/**
 * Rewrites detected `PayCraft.configure { ... }` blocks to `PayCraft.initialize(apiKey = ...)`.
 */
class PayCraftSuiteRewriter {

    fun rewrite(source: String, matches: List<PayCraftConfigBlockParser.Match>): String {
        var result = source
        // Rewrite right-to-left to preserve offset positions
        matches.sortedByDescending { it.rangeStart }.forEach { m ->
            val replacement = """PayCraft.initialize(
    apiKey = "pk_live_FROM_DASHBOARD",  // see MIGRATION_DASHBOARD_CHECKLIST.md
)"""
            result = result.substring(0, m.rangeStart) + replacement + result.substring(m.rangeEnd)
        }
        return result
    }
}
