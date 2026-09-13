package com.chomugiri.workspace.providers

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * One OpenAI-compatible transport for every provider, mirroring the web build's
 * `openai-compat.ts`. Frames are normalised to the same shape the Chomugiri
 * client already parses, so the UI cannot tell it is talking to Kotlin.
 */
object Upstream {

    data class Config(
        val url: String,
        val headers: Map<String, String>,
        /**
         * Which wire protocol this upstream speaks. Defaults to OpenAI's — what
         * NIM, Pollinations and most gateways use; Anthropic and Gemini need
         * their own request shape, headers and reader.
         */
        val dialect: String = Dialects.OPENAI,
        /**
         * The URL when the route depends on streaming. Gemini has two separate
         * endpoints, so one fixed URL sends a non-streaming request to an SSE
         * route and gets back something the JSON reader cannot parse.
         */
        val urlFor: ((Boolean) -> String)? = null,
        val describeError: ((Int, String) -> ErrorInfo?)? = null,
        val shapeBody: ((JSONObject) -> Unit)? = null,
        val timeoutMs: Int = 300_000,
    )

    data class ErrorInfo(val message: String, val code: String, val retryable: Boolean)

    /** Emitted frames, matching the web gateway's contract exactly. */
    sealed interface Frame {
        data class Delta(val text: String) : Frame
        data class Reasoning(val text: String) : Frame
        data class Usage(val prompt: Int?, val completion: Int?, val total: Int?) : Frame
        data class Done(val finishReason: String?) : Frame
        data class Err(val info: ErrorInfo) : Frame
    }

    private fun open(cfg: Config, accept: String, stream: Boolean = false): HttpURLConnection =
        (URL(cfg.urlFor?.invoke(stream) ?: cfg.url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = cfg.timeoutMs
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", accept)
            cfg.headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }

    private fun HttpURLConnection.errorBody(): String =
        runCatching { errorStream?.bufferedReader()?.use(BufferedReader::readText) }.getOrNull().orEmpty()

    private fun retryable(status: Int) = status == 408 || status == 425 || status == 429 || status >= 500

    private fun failure(cfg: Config, status: Int, body: String): ErrorInfo {
        cfg.describeError?.invoke(status, body)?.let { return it }
        Dialects.errorFromBody(cfg.dialect, status, body)?.let { return it }

        val message = runCatching {
            val json = JSONObject(body)
            json.optJSONObject("error")?.optString("message")
                ?: json.optString("error").takeIf { it.isNotEmpty() }
                ?: json.optString("detail").takeIf { it.isNotEmpty() }
                ?: json.optString("message")
        }.getOrNull().orEmpty().ifEmpty { body.take(400) }

        return ErrorInfo("$status $message".trim(), "http_$status", retryable(status))
    }

    fun buildBody(request: JSONObject, model: String, stream: Boolean): JSONObject =
        JSONObject().apply {
            put("model", model)
            put("messages", request.optJSONArray("messages") ?: JSONArray())
            put("stream", stream)
            if (request.has("temperature")) put("temperature", request.getDouble("temperature"))
            if (request.has("topP")) put("top_p", request.getDouble("topP"))
            if (request.has("maxTokens")) put("max_tokens", request.getInt("maxTokens"))
            if (request.optBoolean("json")) {
                put("response_format", JSONObject().put("type", "json_object"))
            }
        }

    /** Pull the two delta shapes every OpenAI-compatible vendor uses out of a chunk. */
    fun framesFromPayload(payload: JSONObject, emit: (Frame) -> Unit) {
        payload.optJSONObject("error")?.let {
            emit(Frame.Err(ErrorInfo(it.optString("message", "upstream error"), "upstream_stream_error", false)))
            return
        }

        val choice = payload.optJSONArray("choices")?.optJSONObject(0)
        val delta = choice?.optJSONObject("delta") ?: choice?.optJSONObject("message")

        if (delta != null) {
            val reasoning = delta.optString("reasoning_content").takeIf { it.isNotEmpty() }
                ?: delta.optString("reasoning").takeIf { it.isNotEmpty() }
            if (reasoning != null) emit(Frame.Reasoning(reasoning))

            val content = delta.optString("content")
            if (content.isNotEmpty()) emit(Frame.Delta(content))
        } else {
            choice?.optString("text")?.takeIf { it.isNotEmpty() }?.let { emit(Frame.Delta(it)) }
        }

        payload.optJSONObject("usage")?.let {
            emit(
                Frame.Usage(
                    it.optInt("prompt_tokens").takeIf { v -> v > 0 },
                    it.optInt("completion_tokens").takeIf { v -> v > 0 },
                    it.optInt("total_tokens").takeIf { v -> v > 0 },
                )
            )
        }

        choice?.optString("finish_reason")?.takeIf { it.isNotEmpty() && it != "null" }
            ?.let { emit(Frame.Done(it)) }
    }

    /**
     * Stream a completion. Never throws — transport failures arrive as an `Err`
     * frame so the UI degrades instead of unmounting mid-render.
     */
    fun stream(cfg: Config, request: JSONObject, model: String, emit: (Frame) -> Unit) {
        val body = Dialects.requestBody(cfg.dialect, request, model, true).also { cfg.shapeBody?.invoke(it) }

        val conn = runCatching { open(cfg, "text/event-stream", stream = true) }.getOrElse {
            emit(Frame.Err(ErrorInfo("Cannot reach ${cfg.url}: ${it.message}", "network_error", true)))
            emit(Frame.Done(null)); return
        }

        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }

            val status = conn.responseCode
            if (status !in 200..299) {
                emit(Frame.Err(failure(cfg, status, conn.errorBody())))
                emit(Frame.Done("error")); return
            }

            // Some upstreams ignore `stream` and answer with a whole JSON object.
            if (conn.contentType?.contains("event-stream") != true) {
                val text = conn.inputStream.bufferedReader().use(BufferedReader::readText)
                // Not every gateway uses HTTP status codes; some answer 200 with
                // the failure in the body, which otherwise reaches the user as
                // raw JSON in place of the assistant's reply.
                (cfg.describeError?.invoke(status, text) ?: EndpointProbe.envelopeError(text))?.let {
                    emit(Frame.Err(it)); emit(Frame.Done("error")); return
                }
                runCatching { Dialects.framesFromResponse(cfg.dialect, JSONObject(text), emit) }
                    .onFailure { emit(Frame.Delta(text)) }
                emit(Frame.Done("stop")); return
            }

            var emittedDone = false
            conn.inputStream.bufferedReader().use { reader ->
                reader.forEachLine { line ->
                    if (!line.startsWith("data:")) return@forEachLine
                    val data = line.removePrefix("data:").trim()
                    if (data.isEmpty()) return@forEachLine
                    if (data == "[DONE]") {
                        if (!emittedDone) { emittedDone = true; emit(Frame.Done("stop")) }
                        return@forEachLine
                    }
                    runCatching {
                        Dialects.framesFromStreamChunk(cfg.dialect, JSONObject(data)) { frame ->
                            // A finish_reason chunk and a trailing [DONE] both mean
                            // finished; emitting twice closes the run twice downstream.
                            if (frame is Frame.Done) {
                                if (emittedDone) return@framesFromStreamChunk
                                emittedDone = true
                            }
                            emit(frame)
                        }
                    }
                }
            }
            if (!emittedDone) emit(Frame.Done(null))
        } catch (e: Exception) {
            emit(Frame.Err(ErrorInfo("Stream interrupted: ${e.message}", "stream_interrupted", true)))
            emit(Frame.Done("error"))
        } finally {
            runCatching { conn.disconnect() }
        }
    }

    data class Completion(val content: String, val reasoning: String, val error: ErrorInfo?)

    /** Single-shot completion, used by the classifier and the planner. */
    fun complete(cfg: Config, request: JSONObject, model: String): Completion {
        val content = StringBuilder()
        val reasoning = StringBuilder()
        var error: ErrorInfo? = null

        val body = Dialects.requestBody(cfg.dialect, request, model, false).also { cfg.shapeBody?.invoke(it) }

        val conn = runCatching { open(cfg, "application/json", stream = false) }.getOrElse {
            return Completion("", "", ErrorInfo("Cannot reach ${cfg.url}: ${it.message}", "network_error", true))
        }

        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = conn.responseCode
            if (status !in 200..299) return Completion("", "", failure(cfg, status, conn.errorBody()))

            val text = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            (cfg.describeError?.invoke(status, text) ?: EndpointProbe.envelopeError(text))
                ?.let { return Completion("", "", it) }

            runCatching {
                Dialects.framesFromResponse(cfg.dialect, JSONObject(text)) { frame ->
                    when (frame) {
                        is Frame.Delta -> content.append(frame.text)
                        is Frame.Reasoning -> reasoning.append(frame.text)
                        is Frame.Err -> error = frame.info
                        else -> Unit
                    }
                }
            }.onFailure { content.append(text) }
        } catch (e: Exception) {
            error = ErrorInfo("Request failed: ${e.message}", "network_error", true)
        } finally {
            runCatching { conn.disconnect() }
        }

        return Completion(content.toString(), reasoning.toString(), error)
    }

    /** Plain GET returning the body, or null on any failure. */
    /** A GET plus the status, so an auth failure can be told from a missing route. */
    data class Fetched(val status: Int, val body: String?)

    fun getWithStatus(url: String, headers: Map<String, String>, timeoutMs: Int = 25_000): Fetched = runCatching {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = timeoutMs
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        try {
            val status = conn.responseCode
            val body = if (status in 200..299)
                conn.inputStream.bufferedReader().use(BufferedReader::readText)
            else null
            Fetched(status, body)
        } finally {
            conn.disconnect()
        }
    }.getOrElse { Fetched(0, null) }

    fun get(url: String, headers: Map<String, String>, timeoutMs: Int = 25_000): String? = runCatching {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = timeoutMs
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        try {
            if (conn.responseCode !in 200..299) null
            else conn.inputStream.bufferedReader().use(BufferedReader::readText)
        } finally {
            conn.disconnect()
        }
    }.getOrNull()
}
