public class PayCraftEvent(
    public val name: PayCraftEventName,
    public val step: PayCraftStep,
    public val platform: String,
    public val sku: String? = null,
    public val reason: String? = null,
    public val atMs: Long,
) {
    public fun params(): Map<String, String> = buildMap {
        put("step", step.wire)
        put("platform", platform)
        sku?.let { put("sku", it) }
        reason?.let { put("reason", it) }
    }

    private companion object {
        const val MAX_VALUE = 100
    }
}
