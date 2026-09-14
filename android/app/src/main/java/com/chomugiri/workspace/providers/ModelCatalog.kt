package com.chomugiri.workspace.providers

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Reading the model list off an arbitrary endpoint.
 *
 * The obvious version of this — GET `{base}/models`, decode `{data:[{id}]}` —
 * is what reported working endpoints as answering nothing. Three things break
 * it, and all three are real:
 *
 *  - the list is not always at `{base}/models`. kie.ai serves chat at `/v1` and
 *    its catalogue at `/api/v1/models`, a different prefix entirely;
 *  - the envelope is not always `{data}`. Gemini answers `{models:[{name}]}`,
 *    and kie.ai wraps its list as `{code,msg,data:{models:[{model}]}}`;
 *  - the field is `owned_by`, not `ownedBy`. Decoding it into a camelCase
 *    property without `@SerialName` silently yields null on every row.
 */
object ModelCatalog {

    @Serializable
    data class ModelInfo(
        val id: String,
        @SerialName("owned_by")
        val ownedBy: String? = null,
        /** Which listing shape this row came from — useful when reporting. */
        val source: String = "",
    )

    /** OpenAI's and Anthropic's shape. */
    @Serializable
    data class ModelsResponse(val data: List<ModelObject> = emptyList())

    @Serializable
    data class ModelObject(
        val id: String = "",
        @SerialName("owned_by")
        val ownedBy: String? = null,
        /** kie.ai keys its rows on `model`; Gemini on `name`. */
        val model: String = "",
        val name: String = "",
        val slug: String = "",
    ) {
        /** The first field that actually carries an id. */
        fun identifier(): String =
            listOf(id, model, slug, name).firstOrNull { it.isNotEmpty() }?.removePrefix("models/").orEmpty()
    }

    /**
     * Every path worth asking, in order.
     *
     * Deliberately includes paths outside the chat base: an endpoint whose chat
     * lives at `/v1` may list its models at `/api/v1`, which appending can
     * never reach.
     */
    fun candidatePaths(dialect: String, base: String): List<String> {
        val trimmed = base.trimEnd('/')
        val out = mutableListOf(Dialects.modelListUrl(dialect, trimmed))

        runCatching { java.net.URL(trimmed) }.getOrNull()?.let { url ->
            val port = if (url.port == -1) "" else ":${url.port}"
            val origin = "${url.protocol}://${url.host}$port"
            val path = url.path.trimEnd('/')

            if (path.startsWith("/api")) out += "$origin${path.drop(4)}/models"
            else out += "$origin/api$path/models"
            if (path.isNotEmpty()) out += "$origin/models"
        }

        return out.distinct()
    }

    /**
     * Ids out of whatever the endpoint answered.
     *
     * Tries the typed decode first and falls back to walking the tree, because
     * "some shape we have not met yet" is the normal case for a field that any
     * gateway can define however it likes.
     */
    fun parse(dialect: String, body: String?, source: String = ""): List<ModelInfo> {
        if (body.isNullOrBlank()) return emptyList()

        val root = runCatching { CustomEndpoint.json.parseToJsonElement(body) }.getOrNull() ?: return emptyList()

        // Gemini: { models: [{ name: "models/gemini-3-pro" }] }
        if (dialect == Dialects.GEMINI) {
            return rowsOf(root, "models").mapNotNull { it.toInfo(source) }
        }

        // OpenAI and Anthropic: { data: [{ id }] }
        val direct = rowsOf(root, "data").mapNotNull { it.toInfo(source) }
        if (direct.isNotEmpty()) return direct

        // kie.ai and friends: { code, msg, data: { models: [{ model }] } }
        val nested = (root as? JsonObject)?.get("data") as? JsonObject
        if (nested != null) {
            for (key in listOf("models", "data", "items", "list")) {
                val rows = rowsOf(nested, key).mapNotNull { it.toInfo(source) }
                if (rows.isNotEmpty()) return rows
            }
        }

        // A bare array, which some self-hosted servers answer with.
        if (root is JsonArray) return root.mapNotNull { it.asObject()?.toInfo(source) }

        return emptyList()
    }

    private fun rowsOf(element: JsonElement, key: String): List<ModelObject> {
        val array = (element as? JsonObject)?.get(key) as? JsonArray ?: return emptyList()
        return array.mapNotNull { it.asObject() }
    }

    private fun JsonElement.asObject(): ModelObject? {
        // A list of plain strings is a model list too.
        (this as? JsonPrimitive)?.let { if (it.isString) return ModelObject(id = it.content) }
        val obj = this as? JsonObject ?: return null
        return runCatching { CustomEndpoint.json.decodeFromJsonElement(ModelObject.serializer(), obj) }.getOrNull()
    }

    private fun ModelObject.toInfo(source: String): ModelInfo? =
        identifier().takeIf { it.isNotEmpty() }?.let { ModelInfo(it, ownedBy, source) }

    /**
     * The models an endpoint will actually serve.
     *
     * Blocking on purpose: it is called from the embedded server's worker
     * thread, which is already a thread per request. Wrapping it in coroutines
     * would add a dependency and a dispatcher to reach the same place.
     */
    fun fetchAvailableModels(endpoint: CustomEndpoint): List<ModelInfo> {
        val dialect = endpoint.resolvedDialect()
        val headers = endpoint.resolvedHeaders()

        for (url in candidatePaths(dialect, endpoint.resolvedBase())) {
            val fetched = Upstream.getWithStatus(url, headers, 15_000)
            // An auth failure is conclusive: trying the next path would only
            // turn "your key was refused" into "nothing answered".
            if (fetched.status == 401 || fetched.status == 403) return emptyList()
            if (fetched.body == null) continue

            val models = parse(dialect, fetched.body, source = url)
            if (models.isNotEmpty()) return models
        }
        return emptyList()
    }
}
