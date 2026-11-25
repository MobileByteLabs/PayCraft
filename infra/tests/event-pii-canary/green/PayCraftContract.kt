object PayCraftContract {
    fun eventsBody(apiKey: String, deviceRef: String, deviceToken: String?, events: List<PayCraftEvent>): JsonObject =
        buildJsonObject {
            put("apiKey", apiKey)
            put("deviceRef", deviceRef)
            put(
                "events",
                buildJsonArray {
                    events.forEach { e ->
                        add(
                            buildJsonObject {
                                put("name", e.name.wire)
                                put("step", e.step.wire)
                                e.attemptId?.let { put("attempt_id", it) }
                                e.failure?.let { f ->
                                    put(
                                        "failure",
                                        buildJsonObject {
                                            put("stage", f.stage.wire)
                                            put("error_class", f.errorClass)
                                            put("error_code", f.code)
                                            put("error_message", f.message)
                                        },
                                    )
                                }
                                put("at", e.atMs)
                            },
                        )
                    }
                },
            )
        }

    fun winbackUrl(base: String) = base
}
