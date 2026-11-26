public class PayCraftEvent(
    public val name: PayCraftEventName,
    public val step: PayCraftStep,
    public val platform: String,
    public val sku: String? = null,
    public val reason: String? = null,
    public val atMs: Long,
    public val attemptId: String? = null,
    public val failure: PayCraftFailure? = null,
) {
    public val code: String? get() = failure?.code

    public fun params(): Map<String, String> = buildMap {
        put("step", step.wire)
        put("platform", platform)
        sku?.let { put("sku", it) }
        reason?.let { put("reason", it) }
        attemptId?.let { put("attempt_id", it) }
        failure?.let {
            put("stage", it.stage.wire)
            put("error_class", it.errorClass)
            put("code", it.code)
        }
    }

    private companion object {
        const val MAX_VALUE = 100
    }
}
