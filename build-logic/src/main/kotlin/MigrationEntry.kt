import java.io.File

data class MigrationEntry(
    val file: String,
    val supabaseUrl: String?,
    val providers: List<String>,
    val planSkus: List<String>,
    val supportEmail: String?,
)
