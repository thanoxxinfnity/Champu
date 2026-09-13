package com.chomugiri.workspace.providers

import org.json.JSONArray
import org.json.JSONObject

/**
 * Reading an arbitrary OpenAI-compatible endpoint, natively.
 *
 * This is the Kotlin twin of the web build's `model-list.ts` + `envelope-error.ts`.
 * It exists because the APK answers `/api/endpoints/probe` itself: every fix made
 * on the TypeScript side was invisible inside the app until this file existed,
 * which is exactly how a working endpoint kept reporting "answered nothing".
 *
 * Pure — no network, no state — so the JVM suite can exercise it directly.
 */
object EndpointProbe {

    /**
     * Cleans up a base URL that is nearly right.
     *
     * People paste the URL from the docs, which is an endpoint rather than a
     * base: `.../v1/models` or `.../v1/chat/completions`. Taken literally that
     * makes the probe ask for `/v1/models/models`, and the error blames the
     * endpoint for the paste.
     */
    fun normalizeBase(input: String): String {
        var base = input.trim().trimEnd('/')
        // Longest first, so /chat/completions never leaves a stray /chat.
        for (suffix in listOf("/chat/completions", "/completions", "/models", "/chat")) {
            if (base.lowercase().endsWith(suffix)) {
                base = base.dropLast(suffix.length)
                break
            }
        }
        return base.trimEnd('/')
    }

    private fun originOf(url: String): String? = runCatching {
        val u = java.net.URL(url)
        val port = if (u.port == -1) "" else ":${u.port}"
        "${u.protocol}://${u.host}$port"
    }.getOrNull()

    private fun pathOf(url: String): String =
        runCatching { java.net.URL(url).path.trimEnd('/') }.getOrNull().orEmpty()

    data class Candidate(val url: String, val label: String)

    /**
     * Where an endpoint might publish its model list.
     *
     * Deliberately includes paths *outside* the chat base: kie.ai serves chat at
     * `/v1/chat/completions` but lists models at `/api/v1/models`, which cannot
     * be reached by appending to the base at all.
     */
    fun modelListCandidates(base: String): List<Candidate> {
        val trimmed = base.trimEnd('/')
        val out = mutableListOf(Candidate("$trimmed/models", "/models"))

        val origin = originOf(trimmed)
        if (origin != null) {
            val path = pathOf(trimmed)
            if (path.startsWith("/api")) {
                val without = path.drop(4)
                out += Candidate("$origin$without/models", "$without/models")
            } else {
                out += Candidate("$origin/api$path/models", "/api$path/models")
            }
            if (path.isNotEmpty()) out += Candidate("$origin/models", "/models (root)")
        }

        val seen = HashSet<String>()
        return out.filter { seen.add(it.url) }
    }

    /**
     * Bases whose `/chat/completions` might answer.
     *
     * The model list and the chat route need not share a prefix, and picking the
     * wrong one leaves an endpoint that probes perfectly and then cannot answer
     * a single message.
     */
    fun chatBaseCandidates(base: String): List<String> {
        val trimmed = normalizeBase(base)
        val out = mutableListOf(trimmed)

        val origin = originOf(trimmed)
        if (origin != null) {
            val path = pathOf(trimmed)
            if (path.startsWith("/api")) out += (origin + path.drop(4)).ifEmpty { origin }
            else out += "$origin/api$path"
        }

        val seen = HashSet<String>()
        return out.filter { it.isNotEmpty() && seen.add(it) }
    }

    private fun pick(row: Any?): String? = when (row) {
        is String -> row.takeIf { it.isNotEmpty() }
        is JSONObject -> listOf("id", "model", "name", "slug")
            .firstNotNullOfOrNull { k -> row.optString(k).takeIf { it.isNotEmpty() } }
        else -> null
    }

    private fun fromArray(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { pick(arr.opt(it)) }
    }

    /**
     * Model ids out of whatever shape the endpoint returned.
     *
     * OpenAI uses `{ data: [{ id }] }`. Others use `{ models: [...] }`, a bare
     * array, or a `{ code, msg, data: { models: [...] } }` envelope. All of them
     * are real, and all of them are a model list.
     */
    fun modelIdsFrom(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()

        runCatching { JSONArray(text) }.getOrNull()?.let { return fromArray(it) }
        val obj = runCatching { JSONObject(text) }.getOrNull() ?: return emptyList()

        for (key in listOf("data", "models")) {
            val direct = fromArray(obj.optJSONArray(key))
            if (direct.isNotEmpty()) return direct
        }

        obj.optJSONObject("data")?.let { nested ->
            for (key in listOf("models", "data", "items", "list")) {
                val found = fromArray(nested.optJSONArray(key))
                if (found.isNotEmpty()) return found
            }
        }

        return emptyList()
    }

    /**
     * Ids that are plainly not chat models.
     *
     * A gateway's list is everything it can do, not everything it can chat with:
     * kie.ai lists 206 entries, most of them video, image, audio or upscaling.
     * Offering all of them in a chat switcher is how a user picks something that
     * cannot answer — and the failure reads as "the app is broken".
     */
    val NOT_CHAT: Regex = Regex(
        listOf(
            "(text|image|img|audio|speech)[-_]?to[-_]?(video|image|speech|audio|music|3d|model|dialogue)",
            "\\b(tts|stt|whisper|lipsync|upscale|upscaler|inpaint|outpaint|animate|extend|remix|relight|restyle|denoise|embed|embedding|rerank|moderation)\\b",
            "remove[-_]?bg|background[-_]?removal|from[-_]?audio|crisp[-_]?upscale",
            "\\b(video|music|audio|veo|kling|sora|runway|seedance|pika|luma|hailuo|dall[-_]?e|midjourney|imagen|flux|seedream|recraft|ideogram|infinitalk|elevenlabs)\\d*(?:[-_/][\\w.-]*)?\\b",
            "\\bnano[-_]?banana\\b|\\bqwen[-_/]image\\b|\\bgrok[-_]imagine\\b|\\b4o[-_]image\\b|\\bwan/\\S+",
        ).joinToString("|"),
        RegexOption.IGNORE_CASE,
    )

    /** Keeps the entries that could plausibly hold a conversation. */
    fun chatModelsOnly(ids: List<String>): List<String> {
        val chat = ids.filter { !NOT_CHAT.containsMatchIn(it) }
        // An empty result means the heuristic is wrong for this endpoint, and
        // showing everything beats showing nothing.
        return chat.ifEmpty { ids }
    }

    /**
     * An error returned inside a 200.
     *
     * Not every gateway uses HTTP status codes. kie.ai answers
     * `200 {"code":422,"msg":"The model is not supported"}` — without this, that
     * body reaches the parser, yields no deltas, and gets emitted as the
     * assistant's reply: raw JSON where the answer should be, and nothing
     * anywhere saying the request failed.
     *
     * Conservative on purpose: a payload carrying real content is an answer,
     * whatever else it says.
     */
    fun envelopeError(text: String?): Upstream.ErrorInfo? {
        if (text.isNullOrBlank() || text.length > 8000) return null
        val body = runCatching { JSONObject(text) }.getOrNull() ?: return null

        if ((body.optJSONArray("choices")?.length() ?: 0) > 0) return null
        if (body.optString("content").isNotEmpty()) return null

        val code = if (body.opt("code") is Number) body.optInt("code") else null

        val message = body.optString("msg").takeIf { it.isNotEmpty() }
            ?: body.optString("message").takeIf { it.isNotEmpty() }
            ?: body.optJSONObject("error")?.optString("message")?.takeIf { it.isNotEmpty() }
            ?: body.optString("error").takeIf { it.isNotEmpty() }
            ?: return null

        val unsupported = Regex("not supported|unsupported|unknown model|no such model", RegexOption.IGNORE_CASE)
            .containsMatchIn(message)

        return Upstream.ErrorInfo(
            if (unsupported)
                "$message — this endpoint does not serve that model id. Check the exact id the provider accepts; a model appearing in its /models list does not guarantee its chat API will serve it."
            else message,
            if (unsupported) "model_unsupported" else "upstream_${code ?: "error"}",
            code != null && code >= 500,
        )
    }
}
