package com.chomugiri.workspace.providers

import org.json.JSONArray
import org.json.JSONObject

/**
 * The three wire protocols a "custom endpoint" can actually speak.
 *
 * The Kotlin twin of src/lib/providers/dialects.ts, and it has to exist for the
 * same reason the probe did: the APK answers /api/chat and /api/endpoints/probe
 * natively, so a fix made only on the web side never reaches the phone.
 *
 * Chomugiri spoke OpenAI's dialect and nothing else. That is one of three:
 *   - Anthropic gateways serve POST {base}/messages, read `x-api-key`, require
 *     `anthropic-version` and `max_tokens`, take `system` as its own field, and
 *     answer with content blocks.
 *   - Gemini serves POST {base}/models/{model}:generateContent, reads
 *     `x-goog-api-key`, calls messages `contents`, names the assistant role
 *     `model`, and answers with candidates.
 *
 * Asking either in OpenAI's dialect 404s the route or 401s the key.
 */
object Dialects {

    const val OPENAI = "openai"
    const val ANTHROPIC = "anthropic"
    const val GEMINI = "gemini"

    val ALL = listOf(OPENAI, ANTHROPIC, GEMINI)

    private const val ANTHROPIC_VERSION = "2023-06-01"

    /** The dialect a pasted URL is announcing, or null when nothing is decisive. */
    fun fromUrl(url: String): String? {
        val u = url.lowercase()
        if (Regex("/messages(/|$|\\?)").containsMatchIn(u) || u.contains("anthropic")) return ANTHROPIC
        if (u.contains("generativelanguage.googleapis.com") ||
            u.contains(":generatecontent") ||
            u.contains(":streamgeneratecontent") ||
            Regex("/v1beta(/|$)").containsMatchIn(u)
        ) return GEMINI
        if (Regex("/chat/completions(/|$|\\?)").containsMatchIn(u) || Regex("/v1(/|$)").containsMatchIn(u)) return OPENAI
        return null
    }

    /**
     * A pasted endpoint, reduced to the base its dialect builds paths from.
     *
     * Taken literally, `.../v1/messages` becomes `/v1/messages/chat/completions`
     * — which answers nothing, and the error then blames the endpoint.
     */
    fun normalizeBase(input: String, dialect: String? = null): String {
        var base = input.trim().replace(Regex("[?#].*$"), "").trimEnd('/')

        // Gemini names the model inside the path.
        base = base.replace(Regex("/models/[^/]*:(stream)?[Gg]enerate[Cc]ontent$"), "")

        for (suffix in listOf("/chat/completions", "/completions", "/messages", "/models", "/chat")) {
            if (base.lowercase().endsWith(suffix)) {
                base = base.dropLast(suffix.length)
                break
            }
        }
        if (dialect == ANTHROPIC && !Regex("/v\\d[^/]*$").containsMatchIn(base)) base = "$base/v1"
        return base.trimEnd('/')
    }

    /**
     * The header each dialect authenticates with.
     *
     * A Bearer token is a 401 on both of the others.
     */
    fun authHeaders(dialect: String, apiKey: String?): Map<String, String> = when (dialect) {
        ANTHROPIC -> buildMap {
            if (!apiKey.isNullOrEmpty()) put("x-api-key", apiKey)
            put("anthropic-version", ANTHROPIC_VERSION)
        }
        GEMINI -> if (apiKey.isNullOrEmpty()) emptyMap() else mapOf("x-goog-api-key" to apiKey)
        else -> if (apiKey.isNullOrEmpty()) emptyMap() else mapOf("Authorization" to "Bearer $apiKey")
    }

    fun hasAuthHeader(dialect: String, headers: Map<String, String>): Boolean {
        val names = headers.keys.map { it.lowercase() }
        return when (dialect) {
            ANTHROPIC -> names.contains("x-api-key")
            GEMINI -> names.contains("x-goog-api-key")
            else -> names.contains("authorization")
        }
    }

    fun chatUrl(dialect: String, base: String, model: String, stream: Boolean): String {
        val trimmed = base.trimEnd('/')
        return when (dialect) {
            ANTHROPIC -> "$trimmed/messages"
            GEMINI -> {
                val method = if (stream) "streamGenerateContent" else "generateContent"
                val id = model.removePrefix("models/")
                "$trimmed/models/$id:$method" + if (stream) "?alt=sse" else ""
            }
            else -> "$trimmed/chat/completions"
        }
    }

    fun modelListUrl(dialect: String, base: String): String = "${base.trimEnd('/')}/models"

    private fun textOf(content: Any?): String = when (content) {
        is String -> content
        is JSONArray -> (0 until content.length()).joinToString("") { i ->
            content.optJSONObject(i)?.takeIf { it.optString("type") == "text" }?.optString("text").orEmpty()
        }
        else -> content?.toString().orEmpty()
    }

    /** One request, in the dialect's own shape. */
    fun requestBody(dialect: String, request: JSONObject, model: String, stream: Boolean): JSONObject {
        val messages = request.optJSONArray("messages") ?: JSONArray()

        if (dialect == ANTHROPIC) {
            val system = StringBuilder()
            val turns = JSONArray()
            for (i in 0 until messages.length()) {
                val m = messages.optJSONObject(i) ?: continue
                val role = m.optString("role")
                val text = textOf(m.opt("content"))
                if (role == "system") {
                    if (system.isNotEmpty()) system.append("\n\n")
                    system.append(text)
                } else if (role == "user" || role == "assistant") {
                    turns.put(JSONObject().put("role", role).put("content", text))
                }
            }
            if (turns.length() == 0) turns.put(JSONObject().put("role", "user").put("content", ""))

            return JSONObject().apply {
                put("model", model)
                // Anthropic 400s without it, which an OpenAI-shaped caller never sends.
                put("max_tokens", if (request.has("maxTokens")) request.optInt("maxTokens") else 8192)
                put("messages", turns)
                put("stream", stream)
                if (system.isNotEmpty()) put("system", system.toString())
                if (request.has("temperature")) put("temperature", request.optDouble("temperature"))
                if (request.has("topP")) put("top_p", request.optDouble("topP"))
            }
        }

        if (dialect == GEMINI) {
            val system = StringBuilder()
            val contents = JSONArray()
            for (i in 0 until messages.length()) {
                val m = messages.optJSONObject(i) ?: continue
                val role = m.optString("role")
                val text = textOf(m.opt("content"))
                if (role == "system") {
                    if (system.isNotEmpty()) system.append("\n\n")
                    system.append(text)
                } else if (role == "user" || role == "assistant") {
                    contents.put(
                        JSONObject()
                            // Gemini calls the assistant "model"; "assistant" is rejected.
                            .put("role", if (role == "assistant") "model" else "user")
                            .put("parts", JSONArray().put(JSONObject().put("text", text)))
                    )
                }
            }
            if (contents.length() == 0) {
                contents.put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", ""))))
            }

            val generation = JSONObject().apply {
                if (request.has("temperature")) put("temperature", request.optDouble("temperature"))
                if (request.has("topP")) put("topP", request.optDouble("topP"))
                if (request.has("maxTokens")) put("maxOutputTokens", request.optInt("maxTokens"))
                if (request.optBoolean("json")) put("responseMimeType", "application/json")
            }

            return JSONObject().apply {
                put("contents", contents)
                if (system.isNotEmpty()) {
                    put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system.toString()))))
                }
                if (generation.length() > 0) put("generationConfig", generation)
            }
        }

        return Upstream.buildBody(request, model, stream)
    }

    /** Frames from one non-streaming response body. */
    fun framesFromResponse(dialect: String, payload: JSONObject, emit: (Upstream.Frame) -> Unit) {
        if (dialect == ANTHROPIC) {
            val blocks = payload.optJSONArray("content") ?: JSONArray()
            val thinking = StringBuilder()
            val text = StringBuilder()
            for (i in 0 until blocks.length()) {
                val b = blocks.optJSONObject(i) ?: continue
                when (b.optString("type")) {
                    "thinking" -> thinking.append(b.optString("thinking"))
                    "text" -> text.append(b.optString("text"))
                }
            }
            if (thinking.isNotEmpty()) emit(Upstream.Frame.Reasoning(thinking.toString()))
            if (text.isNotEmpty()) emit(Upstream.Frame.Delta(text.toString()))

            payload.optJSONObject("usage")?.let {
                emit(
                    Upstream.Frame.Usage(
                        it.optInt("input_tokens").takeIf { v -> v > 0 },
                        it.optInt("output_tokens").takeIf { v -> v > 0 },
                        null,
                    )
                )
            }
            payload.optString("stop_reason").takeIf { it.isNotEmpty() }?.let { emit(Upstream.Frame.Done(it)) }
            return
        }

        if (dialect == GEMINI) {
            val candidate = payload.optJSONArray("candidates")?.optJSONObject(0)
            val parts = candidate?.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
            val text = (0 until parts.length()).joinToString("") { parts.optJSONObject(it)?.optString("text").orEmpty() }
            if (text.isNotEmpty()) emit(Upstream.Frame.Delta(text))

            payload.optJSONObject("usageMetadata")?.let {
                emit(
                    Upstream.Frame.Usage(
                        it.optInt("promptTokenCount").takeIf { v -> v > 0 },
                        it.optInt("candidatesTokenCount").takeIf { v -> v > 0 },
                        it.optInt("totalTokenCount").takeIf { v -> v > 0 },
                    )
                )
            }
            candidate?.optString("finishReason")?.takeIf { it.isNotEmpty() }?.let { emit(Upstream.Frame.Done(it)) }
            return
        }

        Upstream.framesFromPayload(payload, emit)
    }

    /**
     * Frames from one streamed payload.
     *
     * Anthropic streams typed events rather than repeated completion objects, so
     * the event type carries the meaning.
     */
    fun framesFromStreamChunk(dialect: String, payload: JSONObject, emit: (Upstream.Frame) -> Unit) {
        if (dialect != ANTHROPIC) {
            framesFromResponse(dialect, payload, emit)
            return
        }

        when (payload.optString("type")) {
            "error" -> {
                val err = payload.optJSONObject("error")
                emit(
                    Upstream.Frame.Err(
                        Upstream.ErrorInfo(
                            err?.optString("message")?.takeIf { it.isNotEmpty() } ?: "Anthropic stream error",
                            err?.optString("type")?.takeIf { it.isNotEmpty() } ?: "anthropic_stream_error",
                            false,
                        )
                    )
                )
            }
            "content_block_delta" -> {
                val delta = payload.optJSONObject("delta")
                when (delta?.optString("type")) {
                    "thinking_delta" -> delta.optString("thinking").takeIf { it.isNotEmpty() }
                        ?.let { emit(Upstream.Frame.Reasoning(it)) }
                    else -> delta?.optString("text")?.takeIf { it.isNotEmpty() }
                        ?.let { emit(Upstream.Frame.Delta(it)) }
                }
            }
            "message_delta" -> {
                payload.optJSONObject("usage")?.optInt("output_tokens")?.takeIf { it > 0 }
                    ?.let { emit(Upstream.Frame.Usage(null, it, null)) }
                payload.optJSONObject("delta")?.optString("stop_reason")?.takeIf { it.isNotEmpty() }
                    ?.let { emit(Upstream.Frame.Done(it)) }
            }
            "message_stop" -> emit(Upstream.Frame.Done("stop"))
            // message_start, content_block_start/stop and ping carry nothing.
            else -> Unit
        }
    }

    /** Model ids out of each dialect's listing shape. */
    fun modelIdsFromList(dialect: String, text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return emptyList()

        if (dialect == GEMINI) {
            val models = json.optJSONArray("models") ?: return emptyList()
            return (0 until models.length()).mapNotNull {
                models.optJSONObject(it)?.optString("name")?.takeIf(String::isNotEmpty)?.removePrefix("models/")
            }
        }

        val data = json.optJSONArray("data") ?: return emptyList()
        return (0 until data.length()).mapNotNull { data.optJSONObject(it)?.optString("id")?.takeIf(String::isNotEmpty) }
    }

    /** A dialect's error envelope, in words worth showing. */
    fun errorFromBody(dialect: String, status: Int, text: String): Upstream.ErrorInfo? {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null

        if (dialect == ANTHROPIC && json.optString("type") == "error") {
            val err = json.optJSONObject("error")
            return Upstream.ErrorInfo(
                "$status ${err?.optString("message").orEmpty().ifEmpty { "Anthropic error" }}",
                err?.optString("type")?.takeIf { it.isNotEmpty() } ?: "http_$status",
                status >= 500,
            )
        }
        if (dialect == GEMINI) {
            val err = json.optJSONObject("error") ?: return null
            val code = err.optInt("code").takeIf { it > 0 } ?: status
            return Upstream.ErrorInfo(
                "$code ${err.optString("message").ifEmpty { "Gemini error" }}",
                err.optString("status").takeIf { it.isNotEmpty() } ?: "http_$status",
                code >= 500,
            )
        }
        return null
    }
}
