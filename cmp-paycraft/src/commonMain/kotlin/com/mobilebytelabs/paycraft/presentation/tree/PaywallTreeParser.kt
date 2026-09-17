package com.mobilebytelabs.paycraft.presentation.tree

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Parses a `workflow` payload from `/config` into [PaywallWorkflow].
 *
 * ## Forward compatibility is the whole design
 * The server can always be newer than the app. A released binary cannot be fixed, so every unknown
 * thing degrades instead of failing: an unrecognised node becomes [PaywallNode.Unknown] (keeping its
 * slot and its siblings), an unrecognised condition drops only that override, and a higher
 * `schema_version` is reported rather than rejected. The one thing that DOES fail is a payload with
 * no steps — there is nothing to show, and pretending otherwise renders a blank paywall.
 *
 * ## Localisation is resolved at render, not here
 * Nodes keep their `text_lid`. Resolution needs a locale, and the locale can change after parse
 * (system setting, tenant override), so baking strings in at parse time would require re-parsing the
 * whole tree on a locale change.
 */
object PaywallTreeParser {

    /** Highest `schema_version` this build renders. A higher one still parses — see [PaywallWorkflow]. */
    const val SUPPORTED_SCHEMA_VERSION: Int = 2

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    fun parse(raw: String): PaywallWorkflow? =
        runCatching { parse(json.parseToJsonElement(raw).jsonObject) }.getOrNull()

    fun parse(root: JsonObject): PaywallWorkflow? {
        val stepsJson = root["steps"] as? JsonArray ?: return null
        if (stepsJson.isEmpty()) return null

        val steps = stepsJson.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            PaywallStep(
                id = id,
                name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                isLastStep = obj["is_last_step"]?.jsonPrimitive?.booleanOrNull ?: true,
                root = obj["components_config"]?.let { node(it.jsonObject) },
            )
        }
        if (steps.isEmpty()) return null

        // A dangling initial_step_id would render nothing at all, so fall back to the first step
        // rather than failing: the server already rejects this shape, and a client that reaches it
        // anyway is better off showing SOMETHING purchasable.
        val declaredInitial = root["initial_step_id"]?.jsonPrimitive?.contentOrNull
        val initial = declaredInitial?.takeIf { id -> steps.any { it.id == id } } ?: steps.first().id

        return PaywallWorkflow(
            schemaVersion = root["schema_version"]?.jsonPrimitive?.intOrNull ?: 1,
            initialStepId = initial,
            steps = steps,
            localizations = localizations(root["localizations"] as? JsonObject),
            colorScheme = root["color_scheme"]?.jsonPrimitive?.contentOrNull ?: "light",
        )
    }

    private fun localizations(obj: JsonObject?): Map<String, Map<String, String>> =
        obj?.entries?.associate { (locale, table) ->
            locale to (
                (table as? JsonObject)?.entries
                    ?.mapNotNull { (lid, v) -> v.jsonPrimitive.contentOrNull?.let { lid to it } }
                    ?.toMap() ?: emptyMap()
                )
        } ?: emptyMap()

    private fun node(obj: JsonObject): PaywallNode {
        val overrides = overrides(obj["overrides"] as? JsonArray)
        return when (obj["type"]?.jsonPrimitive?.contentOrNull) {
            "stack" -> stack(obj, overrides)
            "text" -> PaywallNode.Text(
                textLid = obj.str("text_lid").orEmpty(),
                fontSize = obj.int("font_size") ?: 14,
                fontWeight = obj.int("font_weight_int") ?: 400,
                colorHex = obj.colorHex("color"),
                alignment = obj.str("horizontal_alignment") ?: "leading",
                padding = obj.edges("padding"),
                margin = obj.edges("margin"),
                overrides = overrides,
            )
            "image" -> PaywallNode.Image(
                url = obj.str("url"),
                fitMode = obj.str("fit_mode") ?: "fit",
                cornerRadius = (obj["mask_shape"] as? JsonObject)?.let { m ->
                    (m["corners"] as? JsonObject)?.int("top_leading")
                } ?: 0,
                padding = obj.edges("padding"),
                margin = obj.edges("margin"),
                overrides = overrides,
            )
            "icon" -> PaywallNode.Icon(
                name = obj.str("icon_name").orEmpty(),
                size = obj.int("size") ?: 24,
                tintHex = obj.colorHex("color"),
                overrides = overrides,
            )
            "package" -> PaywallNode.Package(
                roleIdentifier = obj.str("package_id").orEmpty(),
                isSelectedByDefault = obj["is_selected_by_default"]?.jsonPrimitive?.booleanOrNull ?: false,
                stack =
                (obj["stack"] as? JsonObject)?.let { stack(it, overrides(it["overrides"] as? JsonArray)) }
                    ?: PaywallNode.Stack(),
                overrides = overrides,
            )
            "button" -> {
                // An unrecognised action degrades the whole node to Unknown rather than rendering a
                // button that silently does nothing — a dead control on a paywall reads as a broken
                // app, and the user's only recourse is to leave.
                val a = buttonAction(obj)
                if (a == null) {
                    PaywallNode.Unknown("button", overrides)
                } else {
                    PaywallNode.Button(
                        labelLid = obj.str("text_lid").orEmpty(),
                        action = a,
                        stack = (obj["stack"] as? JsonObject)?.let {
                            stack(it, overrides(it["overrides"] as? JsonArray))
                        },
                        overrides = overrides,
                    )
                }
            }
            "purchase_button" -> PaywallNode.PurchaseButton(
                labelLid = obj.str("text_lid").orEmpty(),
                stack = (obj["stack"] as? JsonObject)?.let { stack(it, overrides(it["overrides"] as? JsonArray)) },
                overrides = overrides,
            )
            "restore_purchases" -> PaywallNode.RestorePurchases(obj.str("text_lid").orEmpty(), overrides)
            "footer" -> PaywallNode.Footer(
                components = children(obj),
                sticky = obj["sticky_footer"]?.jsonPrimitive?.booleanOrNull ?: false,
                overrides = overrides,
            )
            "timeline" -> PaywallNode.Timeline(
                items = (obj["items"] as? JsonArray).orEmptyArray().mapNotNull {
                    (node(it.jsonObject) as? PaywallNode.TimelineItem)
                },
                itemSpacing = obj.int("item_spacing") ?: 12,
                overrides = overrides,
            )
            "timeline_item" -> PaywallNode.TimelineItem(
                titleLid = obj.str("title_lid") ?: obj.str("text_lid").orEmpty(),
                descriptionLid = obj.str("description_lid"),
                icon = (obj["icon"] as? JsonObject)?.let { node(it) as? PaywallNode.Icon },
                overrides = overrides,
            )
            "spacer" -> PaywallNode.Spacer(
                size = obj.int("size") ?: 8,
                grow = obj["grow"]?.jsonPrimitive?.booleanOrNull ?: false,
                overrides = overrides,
            )
            // Unknown, or a node with no `type` at all — same treatment either way.
            else -> PaywallNode.Unknown(obj.str("type") ?: "<missing>", overrides)
        }
    }

    /**
     * `{"action": {"type": "navigate_to", "destination": "step_2"}}`, or the shorthand
     * `{"navigate_to": "step_2"}` that the earlier dashboard drafts emitted.
     */
    private fun buttonAction(obj: JsonObject): ButtonAction? {
        obj.str("navigate_to")?.takeIf { it.isNotBlank() }?.let { return ButtonAction.NavigateTo(it) }
        val a = obj["action"] as? JsonObject ?: return null
        return when (a.str("type")) {
            "navigate_to" -> (a.str("destination") ?: a.str("step_id"))
                ?.takeIf { it.isNotBlank() }
                ?.let(ButtonAction::NavigateTo)
            "purchase" -> ButtonAction.Purchase
            "restore" -> ButtonAction.Restore
            else -> null
        }
    }

    private fun stack(obj: JsonObject, overrides: List<Override>) = PaywallNode.Stack(
        axis = when (obj.str("dimension") ?: obj.str("axis")) {
            "horizontal" -> Axis.HORIZONTAL
            "zlayer" -> Axis.Z
            else -> Axis.VERTICAL
        },
        components = children(obj),
        spacing = obj.int("spacing") ?: 0,
        horizontalAlignment = obj.str("horizontal_alignment") ?: "leading",
        padding = obj.edges("padding"),
        margin = obj.edges("margin"),
        backgroundHex = (obj["background"] as? JsonObject)?.colorHex("value")
            ?: obj.colorHex("background_color"),
        cornerRadius = (obj["shape"] as? JsonObject)?.int("radius") ?: 0,
        borderHex = (obj["border"] as? JsonObject)?.colorHex("color"),
        borderWidth = (obj["border"] as? JsonObject)?.int("width") ?: 0,
        overrides = overrides,
    )

    private fun children(obj: JsonObject): List<PaywallNode> =
        (obj["components"] as? JsonArray).orEmptyArray().map { node(it.jsonObject) }

    private fun overrides(arr: JsonArray?): List<Override> = arr.orEmptyArray().mapNotNull { el ->
        val o = el as? JsonObject ?: return@mapNotNull null
        // An override whose conditions are ALL unrecognised is dropped: applying it would
        // restyle unconditionally, which is the opposite of what it asks for.
        val conditions = (o["conditions"] as? JsonArray).orEmptyArray()
            .mapNotNull { c -> (c as? JsonObject)?.str("type")?.let(Condition::from) }
        if (conditions.isEmpty()) return@mapNotNull null
        val props = (o["properties"] as? JsonObject)?.entries
            ?.mapNotNull { (k, v) -> v.jsonPrimitive.contentOrNull?.let { k to it } }
            ?.toMap() ?: emptyMap()
        Override(conditions, props)
    }

    // ── tiny readers; each returns null rather than throwing on a shape surprise ────────────────
    private fun JsonArray?.orEmptyArray(): List<kotlinx.serialization.json.JsonElement> = this ?: emptyList()
    private fun JsonObject.str(k: String): String? = this[k]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.int(k: String): Int? = this[k]?.jsonPrimitive?.intOrNull

    /** Colour is `{light:{type:"hex",value:"#rrggbbaa"}}`; dark is read at render time. */
    private fun JsonObject.colorHex(k: String): String? =
        ((this[k] as? JsonObject)?.get("light") as? JsonObject)?.str("value")

    private fun JsonObject.edges(k: String): Edges {
        val o = this[k] as? JsonObject ?: return Edges.ZERO
        return Edges(
            top = o.int("top") ?: 0,
            leading = o.int("leading") ?: 0,
            bottom = o.int("bottom") ?: 0,
            trailing = o.int("trailing") ?: 0,
        )
    }
}
