package com.chomugiri.workspace.providers

import org.json.JSONArray
import org.json.JSONObject

/**
 * Provider adapters. Mirrors the web build's provider adapters from the web build,
 * including the error mappings that were verified against the live APIs.
 */

object Nim {
    const val BASE = "https://integrate.api.nvidia.com/v1"
    const val GENAI_BASE = "https://ai.api.nvidia.com/v1/genai"

    const val DEFAULT_MODEL = "moonshotai/kimi-k3"
    const val PLANNER_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

    val EMBED_CANDIDATES = listOf(
        "nvidia/nemotron-3-embed-1b",
        "nvidia/llama-3.2-nv-embedqa-1b-v1",
        "nvidia/nv-embedqa-mistral-7b-v2",
    )

    private fun headers(key: String) = mapOf("Authorization" to "Bearer $key")

    /** Turn NIM's terse failures into something the user can act on. */
    fun describeError(status: Int, body: String): Upstream.ErrorInfo? {
        val detail = runCatching {
            val json = JSONObject(body)
            json.optString("detail").takeIf { it.isNotEmpty() }
                ?: json.optJSONObject("error")?.optString("message")
                ?: json.optString("message")
        }.getOrNull().orEmpty().ifEmpty { body.take(240) }

        return when (status) {
            401, 403 -> Upstream.ErrorInfo(
                "NVIDIA NIM rejected the API key ($status). Open Settings and paste a valid key from build.nvidia.com. $detail".trim(),
                "nim_unauthorized", false,
            )
            404 -> Upstream.ErrorInfo(
                "NVIDIA NIM has no model at that id (404). Model ids rotate — refresh the model switcher. $detail".trim(),
                "nim_model_not_found", false,
            )
            410 -> Upstream.ErrorInfo(
                "This NIM has been retired by NVIDIA and no longer serves requests. $detail Pick another model.".trim(),
                "nim_end_of_life", false,
            )
            429 -> Upstream.ErrorInfo(
                "NVIDIA NIM is rate limiting this key. Back off, or switch to Pollinations while the window resets.",
                "nim_rate_limited", true,
            )
            400 -> Upstream.ErrorInfo("NVIDIA NIM rejected the request payload (400): $detail", "nim_bad_request", false)
            else -> if (status >= 500) Upstream.ErrorInfo("NVIDIA NIM upstream error $status: $detail", "nim_upstream", true) else null
        }
    }

    fun chatConfig(key: String) = Upstream.Config(
        url = "$BASE/chat/completions",
        headers = headers(key),
        describeError = ::describeError,
        shapeBody = { body -> if (body.optBoolean("stream")) body.put("stream_options", JSONObject().put("include_usage", true)) },
    )

    /** Live catalogue. Returns null when the key is absent or the probe fails. */
    fun listModels(key: String): List<String>? {
        if (key.isBlank()) return null
        val body = Upstream.get("$BASE/models", headers(key)) ?: return null
        return runCatching {
            val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
            (0 until data.length()).mapNotNull { data.optJSONObject(it)?.optString("id")?.takeIf(String::isNotEmpty) }
        }.getOrNull()
    }

    /**
     * Image generation. Verified against the live endpoint: FLUX 500s on `mode`
     * and `cfg_scale`, and 422s outside 768-1280 in multiples of 64. The returned
     * artifact is JPEG despite the docs implying PNG.
     */
    fun generateImage(key: String, model: String, prompt: String, width: Int, height: Int, seed: Int, steps: Int): Result<Pair<String, Int>> {
        val isFlux = model.contains("flux")
        val clamp = { v: Int -> (v.coerceIn(768, 1280) / 64.0).let { Math.round(it).toInt() * 64 } }

        val body = JSONObject().apply {
            put("prompt", prompt)
            put("seed", seed)
            if (isFlux) {
                put("width", clamp(width)); put("height", clamp(height))
                put("steps", steps.coerceIn(1, 50))
            } else {
                put("aspect_ratio", if (width == height) "1:1" else "16:9")
                put("steps", steps.coerceIn(1, 50))
                put("cfg_scale", 4.5)
            }
        }

        val conn = runCatching {
            (java.net.URL("$GENAI_BASE/$model").openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true
                connectTimeout = 20_000; readTimeout = 240_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $key")
            }
        }.getOrElse { return Result.failure(it) }

        return try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) {
                val err = runCatching { conn.errorStream?.bufferedReader()?.readText() }.getOrNull().orEmpty()
                return Result.failure(IllegalStateException(describeError(conn.responseCode, err)?.message ?: "HTTP ${conn.responseCode}"))
            }

            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            val artifact = json.optJSONArray("artifacts")?.optJSONObject(0)
            val b64 = artifact?.optString("base64")?.takeIf { it.isNotEmpty() }
                ?: json.optString("image").takeIf { it.isNotEmpty() }
                ?: return Result.failure(IllegalStateException("NIM returned no artifact."))

            Result.success("data:${sniffMime(b64)};base64,$b64" to (artifact?.optInt("seed") ?: seed))
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            runCatching { conn.disconnect() }
        }
    }

    /** The mime is sniffed, not assumed — a wrong one breaks canvas reads. */
    private fun sniffMime(b64: String) = when {
        b64.startsWith("/9j/") -> "image/jpeg"
        b64.startsWith("iVBORw0KGgo") -> "image/png"
        b64.startsWith("UklGR") -> "image/webp"
        else -> "image/png"
    }

    fun embed(key: String, texts: List<String>, inputType: String): Pair<List<List<Double>>, String>? {
        for (model in EMBED_CANDIDATES) {
            val conn = runCatching {
                (java.net.URL("$BASE/embeddings").openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = "POST"; doOutput = true
                    connectTimeout = 15_000; readTimeout = 90_000
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $key")
                }
            }.getOrNull() ?: continue

            try {
                val payload = JSONObject().apply {
                    put("input", JSONArray(texts))
                    put("model", model)
                    put("input_type", inputType)
                    put("encoding_format", "float")
                    put("truncate", "END")
                }
                conn.outputStream.use { it.write(payload.toString().toByteArray()) }

                // Entitlements are per-account: an id can be in /v1/models and
                // still 404 here, so walk the candidates instead of hard-failing.
                if (conn.responseCode == 404) continue
                if (conn.responseCode !in 200..299) continue

                val data = JSONObject(conn.inputStream.bufferedReader().readText()).optJSONArray("data") ?: continue
                val vectors = (0 until data.length()).map { i ->
                    val arr = data.getJSONObject(i).getJSONArray("embedding")
                    (0 until arr.length()).map { arr.getDouble(it) }
                }
                return vectors to model
            } catch (_: Exception) {
                continue
            } finally {
                runCatching { conn.disconnect() }
            }
        }
        return null
    }
}

object Pollinations {
    const val TEXT_BASE = "https://text.pollinations.ai"
    const val IMAGE_BASE = "https://image.pollinations.ai"
    private const val REFERRER = "chomugiri"

    /**
     * Pollinations wraps its real failure inside an HTTP 500 whose body carries
     * the actual status. Reporting "500 402 Payment Required" verbatim tells the
     * user nothing, so the cause and the way out are surfaced instead.
     */
    fun describeError(status: Int, body: String): Upstream.ErrorInfo? {
        if (body.isEmpty()) return null

        val inner = runCatching {
            val json = JSONObject(body)
            json.optString("error").takeIf { it.isNotEmpty() }
                ?: json.optJSONObject("error")?.optString("message").orEmpty()
        }.getOrNull().orEmpty().ifEmpty { if (status >= 400) body.take(240) else "" }

        if (inner.isEmpty()) return null

        return when {
            Regex("402|payment required|quota|insufficient", RegexOption.IGNORE_CASE).containsMatchIn(inner) ->
                Upstream.ErrorInfo(
                    "Pollinations refused with 402 — the keyless tier is out of quota or rate limiting this device. " +
                        "Wait a minute, or switch the model to NVIDIA NIM in the switcher.",
                    "pollinations_quota", true,
                )
            Regex("429|rate limit|too many", RegexOption.IGNORE_CASE).containsMatchIn(inner) ->
                Upstream.ErrorInfo("Pollinations is rate limiting this device. Back off, or switch provider.", "pollinations_rate_limited", true)
            status >= 400 -> Upstream.ErrorInfo("Pollinations: ${inner.take(300)}", "pollinations_error", status >= 500)
            else -> null
        }
    }

    fun chatConfig() = Upstream.Config(
        url = "$TEXT_BASE/openai",
        headers = mapOf("Referer" to REFERRER),
        describeError = ::describeError,
        // The free tier rejects stream_options; keep the payload minimal.
        shapeBody = { body -> body.put("referrer", REFERRER); body.remove("stream_options") },
        timeoutMs = 180_000,
    )

    fun listModels(): List<JSONObject> {
        val body = Upstream.get("$TEXT_BASE/models", mapOf("Referer" to REFERRER)) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(body)
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        }.getOrElse { emptyList() }
    }

    fun imageUrl(prompt: String, model: String, width: Int, height: Int, seed: Int): String {
        val encoded = java.net.URLEncoder.encode(prompt, "UTF-8")
        return "$IMAGE_BASE/prompt/$encoded?model=$model&width=$width&height=$height&nologo=true&seed=$seed&referrer=$REFERRER"
    }

    fun generateImage(prompt: String, model: String, width: Int, height: Int, seed: Int): Result<String> {
        val conn = runCatching {
            (java.net.URL(imageUrl(prompt, model, width, height, seed)).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 20_000; readTimeout = 180_000
                setRequestProperty("Referer", REFERRER)
            }
        }.getOrElse { return Result.failure(it) }

        return try {
            if (conn.responseCode !in 200..299) {
                val err = runCatching { conn.errorStream?.bufferedReader()?.readText() }.getOrNull().orEmpty()
                return Result.failure(IllegalStateException(describeError(conn.responseCode, err)?.message ?: "HTTP ${conn.responseCode}"))
            }

            val type = conn.contentType ?: "image/jpeg"
            if (!type.startsWith("image/")) {
                return Result.failure(IllegalStateException("Pollinations returned $type instead of an image — the free tier is rate limiting."))
            }

            val bytes = conn.inputStream.readBytes()
            Result.success("data:${type.substringBefore(';')};base64," + com.chomugiri.workspace.server.Base64Codec.encode(bytes))
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            runCatching { conn.disconnect() }
        }
    }
}

/**
 * Duck.ai — free models, reached the way DuckDuckGo intends.
 *
 * Mirrors the web build's src/lib/providers/duckai.ts, including the reason there
 * is no chat call here: duck.ai answers HTTP 418 ERR_CHALLENGE to anything that
 * is not a real browser session, and that check is an anti-abuse control. The
 * WebView hands the prompt to duck.ai over the query-string hand-off DuckDuckGo
 * publishes for it instead of forging that check.
 */
object DuckAi {
    const val ORIGIN = "https://duck.ai"

    private const val FREE_TIER =
        "Free on duck.ai with no API key and no account. duck.ai serves it to a real browser only, " +
            "so Chomugiri opens it there with your prompt instead of calling it behind your back."

    /** id to label to vendor to note-prefix. Ids are the strings duck.ai puts on the wire. */
    private val CATALOGUE = listOf(
        Quad("gpt-5.6-luna", "GPT-5.6 Luna", "OpenAI · via Duck.ai", "Best for everyday use."),
        Quad("gpt-5.4-mini", "GPT-5.4 mini", "OpenAI · via Duck.ai", "Solid, but hits limits sooner."),
        Quad("claude-haiku-4-5", "Claude Haiku 4.5", "Anthropic · via Duck.ai", "Solid, but hits limits sooner."),
        Quad("mistral-small-2603", "Mistral Small 4", "Mistral AI · via Duck.ai", ""),
        Quad("tinfoil/gpt-oss-120b", "gpt-oss 120B", "OpenAI · via Duck.ai", "Open-weight, served in a Tinfoil enclave."),
        Quad("tinfoil/gemma4-31b", "Gemma 4 31B", "Google · via Duck.ai", "Open-weight, served in a Tinfoil enclave."),
    )

    data class Quad(val id: String, val label: String, val vendor: String, val blurb: String)

    private val REASONING = setOf("gpt-5.6-luna", "tinfoil/gpt-oss-120b")

    fun listModels(): JSONArray {
        val out = JSONArray()
        CATALOGUE.forEach { m ->
            val caps = mutableListOf("chat")
            if (REASONING.contains(m.id)) caps.add("reasoning")
            out.put(
                JSONObject()
                    .put("id", m.id)
                    .put("provider", "duckai")
                    .put("label", m.label)
                    .put("vendor", m.vendor)
                    .put("capabilities", JSONArray(caps))
                    .put("emitsReasoning", caps.contains("reasoning"))
                    .put("contextWindow", 16000)
                    .put("origin", "browser-only")
                    .put("handoffUrl", ORIGIN)
                    .put("note", if (m.blurb.isEmpty()) FREE_TIER else m.blurb + " " + FREE_TIER)
            )
        }
        return out
    }

    fun count(): Int = CATALOGUE.size

    /**
     * duck.ai's own router reads q, model, prompt and home off the query string.
     * prompt=1 auto-sends; home=1 stops its short-prompt filter from dropping a
     * one-word prompt.
     */
    fun handoffUrl(model: String, prompt: String): String {
        val q = java.net.URLEncoder.encode(prompt.trim(), "UTF-8")
        val base = "$ORIGIN/?q=$q&prompt=1&home=1"
        if (model.isEmpty()) return base
        return base + "&model=" + java.net.URLEncoder.encode(model, "UTF-8")
    }
}
