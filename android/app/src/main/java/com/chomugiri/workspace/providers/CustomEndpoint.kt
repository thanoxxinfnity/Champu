package com.chomugiri.workspace.providers

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A user-configured endpoint, as a type rather than a bag of `optString` calls.
 *
 * Everything here was learned from an endpoint that did not work:
 *
 *  - `dialect` is a string of three values, not an `isOpenAICompatible` boolean.
 *    A boolean cannot say "Anthropic" and "Gemini" — and those are exactly the
 *    two that failed, because both were being asked in OpenAI's dialect.
 *  - `maxTokens` exists because gateways 400 on a ceiling their model cannot
 *    serve, and the run then dies on a number the user never chose.
 *  - `endpointPath` is honoured only for the OpenAI dialect; the other two put
 *    the model in the path themselves, so an override there would break them.
 */
@Serializable
data class CustomEndpoint(
    val id: String = "",
    val label: String = "",
    val baseUrl: String = "",
    val apiKey: String = "",
    /** Optional: the model to use when the caller names none. */
    val modelName: String = "",
    /** OpenAI dialect only. The others derive the path from the model. */
    val endpointPath: String = "",
    val headers: Map<String, String> = emptyMap(),
    /** 0 means "no ceiling of our own"; requests are clamped when it is set. */
    val maxTokens: Int = 0,
    /** Negative means "unset" — the run's own temperature is used. */
    val temperature: Double = -1.0,
    /** "openai", "anthropic" or "gemini". Empty means work it out from the URL. */
    val dialect: String = "",
    /**
     * Accepted for configs written before dialects existed, where the only
     * question anyone thought to ask was OpenAI or not. `false` there meant
     * "something else", which is now a dialect to detect rather than a flag.
     */
    @SerialName("isOpenAICompatible")
    val legacyOpenAiFlag: Boolean? = null,
) {

    /** The protocol to speak, resolved from the stored value or the URL. */
    fun resolvedDialect(): String = when {
        dialect.isNotEmpty() && Dialects.ALL.contains(dialect) -> dialect
        legacyOpenAiFlag == true -> Dialects.OPENAI
        else -> Dialects.fromUrl(baseUrl) ?: Dialects.OPENAI
    }

    /** The base the dialect builds its paths from, with any pasted suffix removed. */
    fun resolvedBase(): String = Dialects.normalizeBase(baseUrl, resolvedDialect())

    /**
     * The headers to send: the user's own, plus the auth header this dialect
     * reads — `x-api-key` for Anthropic, `x-goog-api-key` for Gemini, a Bearer
     * token for OpenAI. Sending the wrong one is a 401 every time.
     */
    fun resolvedHeaders(): Map<String, String> {
        val out = headers.toMutableMap()
        if (!Dialects.hasAuthHeader(resolvedDialect(), out)) {
            out.putAll(Dialects.authHeaders(resolvedDialect(), apiKey))
        }
        return out
    }

    /** The chat URL for one request. */
    fun chatUrl(model: String, stream: Boolean): String {
        val dialect = resolvedDialect()
        val base = resolvedBase()
        // An explicit path is the user overriding detection, and only means
        // anything for the OpenAI shape.
        if (endpointPath.isNotEmpty() && dialect == Dialects.OPENAI) {
            return base + if (endpointPath.startsWith("/")) endpointPath else "/$endpointPath"
        }
        return Dialects.chatUrl(dialect, base, model.ifEmpty { modelName }, stream)
    }

    /** This endpoint as an upstream the transport can drive. */
    fun toConfig(model: String): Upstream.Config {
        val dialect = resolvedDialect()
        val requested = model.ifEmpty { modelName }
        return Upstream.Config(
            url = chatUrl(requested, true),
            headers = resolvedHeaders(),
            dialect = dialect,
            urlFor = { stream -> chatUrl(requested, stream) },
            shapeBody = { body ->
                body.remove("stream_options") // unknown to many self-hosted servers
                Dialects.applyEndpointLimits(body, dialect, maxTokens, temperature)
            },
        )
    }

    companion object {
        /**
         * Lenient on purpose: a config written by an older build, or by hand,
         * must not fail to load because it carries a field this version does
         * not know about.
         */
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }

        fun parse(text: String): Result<CustomEndpoint> = runCatching { json.decodeFromString<CustomEndpoint>(text) }
    }
}
