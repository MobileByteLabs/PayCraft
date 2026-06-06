import java.io.File

/**
 * Text-based detector for `PayCraft.configure { ... }` blocks.
 *
 * Uses regex; a full Kotlin PSI visitor is roadmapped for a future release when
 * nested-block edge cases warrant it.
 */
class PayCraftConfigBlockParser {

    data class Match(
        val rangeStart: Int,
        val rangeEnd: Int,
        val body: String,
    )

    fun findConfigureBlocks(source: String): List<Match> {
        val matches = mutableListOf<Match>()
        // Find "PayCraft.configure {" or "PayCraft.configure()" calls
        val searchToken = "PayCraft.configure"
        var searchFrom = 0
        while (true) {
            val idx = source.indexOf(searchToken, searchFrom)
            if (idx == -1) break
            // Find the opening brace (lambda or block)
            val braceIdx = source.indexOf('{', idx + searchToken.length)
            if (braceIdx == -1) { searchFrom = idx + 1; continue }
            // Find balanced closing brace
            var depth = 0
            var end = braceIdx
            for (i in braceIdx until source.length) {
                when (source[i]) {
                    '{' -> depth++
                    '}' -> {
                        depth--
                        if (depth == 0) { end = i; break }
                    }
                }
            }
            val body = source.substring(braceIdx + 1, end)
            matches.add(Match(rangeStart = idx, rangeEnd = end + 1, body = body))
            searchFrom = end + 1
        }
        return matches
    }

    fun extractEntries(matches: List<Match>, file: File): List<MigrationEntry> {
        return matches.map { m ->
            val body = m.body
            MigrationEntry(
                file = file.path,
                supabaseUrl = Regex("""supabase\(\s*url\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1),
                providers = Regex("""provider\(((\w+Provider)\()""").findAll(body)
                    .map { it.groupValues[2] }.toList(),
                planSkus = Regex("""BillingPlan\([^)]*id\s*=\s*"([^"]+)"""").findAll(body)
                    .map { it.groupValues[1] }.toList(),
                supportEmail = Regex("""supportEmail\(\s*"([^"]+)"""").find(body)?.groupValues?.get(1),
            )
        }
    }
}
