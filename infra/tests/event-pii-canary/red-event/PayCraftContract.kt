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
                                put("at", e.atMs)
                            },
                        )
                    }
                },
            )
        }

    fun winbackUrl(base: String) = base
}
