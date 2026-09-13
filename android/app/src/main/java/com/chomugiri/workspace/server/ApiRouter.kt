package com.chomugiri.workspace.server

import com.chomugiri.workspace.providers.Dialects
import com.chomugiri.workspace.providers.EndpointProbe
import com.chomugiri.workspace.providers.Nim
import com.chomugiri.workspace.providers.Pollinations
import com.chomugiri.workspace.providers.Upstream
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native implementation of Chomugiri's `/api` contract.
 *
 * Every route matches the Next.js handler it replaces — same request shape, same
 * response shape, same error codes — so the web client needs no Android-specific
 * branch anywhere.
 */
class ApiRouter(private val secrets: SecretStore) {

    var nimKey: String
        get() = secrets.get("nim_key")
        set(value) { secrets.put("nim_key", value) }

    /**
     * Credentials that used to live only in the WebView's IndexedDB, which does
     * not survive a change of origin. Kept natively alongside the NIM key so no
     * credential depends on browser storage outliving the app.
     */
    var pollinationsToken: String
        get() = secrets.get("pollinations_token")
        set(value) { secrets.put("pollinations_token", value) }

    var vercelToken: String
        get() = secrets.get("vercel_token")
        set(value) { secrets.put("vercel_token", value) }

    var vercelTeamId: String
        get() = secrets.get("vercel_team_id")
        set(value) { secrets.put("vercel_team_id", value) }

    /**
     * The port the workspace was last served on.
     *
     * Stored because browser storage is scoped to the origin, and the origin
     * includes the port — reusing it is what lets local data survive a restart.
     */
    var servedPort: Int
        get() = secrets.get("served_port").toIntOrNull() ?: 0
        set(value) { secrets.put("served_port", value.toString()) }

    fun handle(request: ApiRequest, response: ResponseWriter) {
        try {
            when (request.path) {
                "/api/models" -> models(response)
                "/api/chat" -> chat(request, response)
                "/api/image" -> image(request, response)
                "/api/endpoints/probe" -> probe(request, response)
                "/api/bridge/proxy" -> bridgeProxy(request, response)
                "/api/vercel/deploy" -> vercelDeploy(request, response)
                "/api/research" -> research(request, response)
                "/api/shell/keys" -> shellKeys(request, response)
                "/api/shell/run" -> shellRun(request, response)
                else -> response.json(404, err("No route for ${request.path}", "no_route"))
            }
        } catch (e: Exception) {
            response.json(500, err("Gateway failure: ${e.message}", "gateway_exception"))
        }
    }

    private fun err(message: String, code: String, retryable: Boolean = false) =
        JSONObject().put("error", message).put("code", code).put("retryable", retryable).toString()

    /**
     * What the shell should do about a run starting or finishing.
     *
     * Set by MainActivity; absent in the JVM tests, where the route still has to
     * answer rather than blow up.
     */
    var onRunState: ((RunState) -> Unit)? = null

    data class RunState(
        val active: Boolean,
        val topic: String,
        /** Only meaningful when `active` is false. */
        val ok: Boolean = true,
        val summary: String = "",
        /** Whether the user has moved away and should be told it finished. */
        val notify: Boolean = false,
    )

    // ── /api/shell/run — Android-only, keeps a backgrounded run alive ────────
    //
    // The page cannot keep itself running when Android freezes the process, and
    // the shell cannot know a run is in flight: the work is driven entirely from
    // the WebView. So the page says so, and the shell holds the process open for
    // exactly that long.
    private fun shellRun(request: ApiRequest, response: ResponseWriter) {
        if (request.method != "POST") { response.json(405, err("POST only.", "bad_method")); return }

        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        val state = RunState(
            active = body.optBoolean("active"),
            topic = body.optString("topic").ifEmpty { "a run" },
            ok = if (body.has("ok")) body.optBoolean("ok") else true,
            summary = body.optString("summary"),
            notify = body.optBoolean("notify"),
        )
        onRunState?.invoke(state)
        response.json(200, JSONObject().put("ok", true).put("active", state.active).toString())
    }

    // ── /api/shell/keys — Android-only, lets the web Settings pane store the key
    private fun shellKeys(request: ApiRequest, response: ResponseWriter) {
        if (request.method == "POST") {
            val body = JSONObject(request.bodyText)
            // Only fields that were sent are touched, so a partial save never
            // silently clears a credential the caller did not mention.
            if (body.has("nimKey")) nimKey = body.optString("nimKey")
            if (body.has("pollinationsToken")) pollinationsToken = body.optString("pollinationsToken")
            if (body.has("vercelToken")) vercelToken = body.optString("vercelToken")
            if (body.has("vercelTeamId")) vercelTeamId = body.optString("vercelTeamId")
            response.json(200, state().put("ok", true).toString())
        } else {
            response.json(200, state().toString())
        }
    }

    /**
     * What the shell holds.
     *
     * The NIM and Pollinations values are reported as booleans only — the web
     * layer never needs to read a key back, and handing it to the page would put
     * a credential somewhere it does not have to be. Vercel is returned because
     * deployment runs through the page's own fetch and genuinely needs it.
     */
    private fun state(): JSONObject = JSONObject()
        .put("nimConfigured", nimKey.isNotEmpty())
        .put("pollinationsConfigured", pollinationsToken.isNotEmpty())
        .put("vercelToken", vercelToken)
        .put("vercelTeamId", vercelTeamId)

    // ── /api/models ─────────────────────────────────────────────────────────

    private fun models(response: ResponseWriter) {
        val out = JSONArray()
        val warnings = JSONArray()
        val key = nimKey

        val liveIds = Nim.listModels(key)
        if (key.isEmpty()) {
            warnings.put("No NVIDIA NIM key set — NIM models are hidden. Open Settings → API Keys. Pollinations needs no key and stays available.")
        } else if (liveIds == null) {
            warnings.put("NVIDIA NIM catalogue unavailable — the key may be invalid or the device is offline.")
        }

        liveIds?.forEach { id ->
            val caps = ModelMeta.capabilities(id)
            out.put(
                JSONObject()
                    .put("id", id)
                    .put("provider", "nim")
                    .put("label", ModelMeta.label(id))
                    .put("vendor", ModelMeta.vendor(id))
                    .put("capabilities", JSONArray(caps))
                    .put("emitsReasoning", caps.contains("reasoning"))
                    .put("origin", "catalogue")
            )
        }

        // Image NIMs live on a different host and never appear in /v1/models.
        if (!key.isEmpty()) {
            out.put(
                JSONObject()
                    .put("id", "black-forest-labs/flux.1-dev")
                    .put("provider", "nim")
                    .put("label", "FLUX.1 [dev]")
                    .put("vendor", "Black Forest Labs")
                    .put("capabilities", JSONArray(listOf("image")))
                    .put("origin", "static")
                    .put("note", "Served from ai.api.nvidia.com. Dimensions must be 768-1280 in multiples of 64.")
            )
        }

        var pollinationsCount = 0
        Pollinations.listModels().forEach { m ->
            val name = m.optString("name")
            if (name.isEmpty()) return@forEach
            val caps = mutableListOf("chat")
            if (m.optBoolean("vision")) caps.add("vision")
            if (m.optBoolean("tools")) caps.add("tools")
            if (m.optBoolean("reasoning")) caps.add("reasoning")
            if (name.contains("search", true)) caps.add("search")

            out.put(
                JSONObject()
                    .put("id", name)
                    .put("provider", "pollinations")
                    .put("label", "Pollinations · $name")
                    .put("vendor", "Pollinations")
                    .put("capabilities", JSONArray(caps))
                    .put("emitsReasoning", caps.contains("reasoning"))
                    .put("origin", "catalogue")
                    .put("note", m.optString("description").takeIf { it.isNotEmpty() })
            )
            pollinationsCount++
        }

        listOf("flux" to "Pollinations · FLUX (image)", "turbo" to "Pollinations · Turbo (image)").forEach { (id, label) ->
            out.put(
                JSONObject()
                    .put("id", id).put("provider", "pollinations").put("label", label)
                    .put("vendor", "Pollinations")
                    .put("capabilities", JSONArray(listOf("image")))
                    .put("origin", "static")
            )
            pollinationsCount++
        }

        val providers = JSONObject()
            .put("nim", JSONObject().put("configured", key.isNotEmpty()).put("count", liveIds?.size ?: 0))
            .put("pollinations", JSONObject().put("configured", true).put("count", pollinationsCount))

        response.json(
            200,
            JSONObject()
                .put("models", out)
                .put("warnings", warnings)
                .put("providers", providers)
                .put("at", System.currentTimeMillis())
                .toString()
        )
    }

    // ── /api/chat ───────────────────────────────────────────────────────────

    private fun configFor(provider: String, body: JSONObject): Pair<Upstream.Config?, String?> = when (provider) {
        "nim" -> {
            if (nimKey.isEmpty()) null to "No NVIDIA NIM key configured. Open Settings → API Keys, or switch the model to Pollinations (zero-key)."
            else Nim.chatConfig(nimKey, body.optString("model")) to null
        }
        "pollinations" -> Pollinations.chatConfig(pollinationsToken) to null
        "custom" -> {
            val custom = body.optJSONObject("custom")
            val raw = custom?.optString("baseUrl").orEmpty()

            // Which protocol the endpoint speaks decides the route, the auth
            // header and the body shape. Stored with the endpoint by the probe;
            // inferred from the URL for one added by hand.
            val dialect = custom?.optString("dialect").orEmpty().ifEmpty { Dialects.fromUrl(raw) ?: Dialects.OPENAI }

            // The stored base can still be a pasted endpoint (added by hand,
            // without a probe); appending /chat/completions to a base that
            // already ends in it asks for a route that does not exist.
            val base = Dialects.normalizeBase(raw, dialect)
            if (base.isEmpty()) null to "A custom provider request needs `custom.baseUrl`."
            else {
                val headers = mutableMapOf<String, String>()
                custom?.optJSONObject("headers")?.let { h ->
                    h.keys().forEach { k -> headers[k] = h.optString(k) }
                }
                val apiKey = custom?.optString("apiKey").orEmpty()
                if (!Dialects.hasAuthHeader(dialect, headers)) {
                    headers.putAll(Dialects.authHeaders(dialect, apiKey))
                }

                val model = body.optString("model")
                val chatPath = custom?.optString("chatPath").orEmpty()
                // An explicit path is the user overriding detection, and only
                // makes sense for the OpenAI shape — the others put the model in
                // the path themselves.
                val override = chatPath.isNotEmpty() && dialect == Dialects.OPENAI

                Upstream.Config(
                    url = if (override) base + if (chatPath.startsWith("/")) chatPath else "/$chatPath"
                    else Dialects.chatUrl(dialect, base, model, true),
                    headers = headers,
                    dialect = dialect,
                    urlFor = if (override) null else ({ stream -> Dialects.chatUrl(dialect, base, model, stream) }),
                    shapeBody = { it.remove("stream_options") },
                ) to null
            }
        }
        else -> null to "Unknown provider \"$provider\"."
    }

    private fun chat(request: ApiRequest, response: ResponseWriter) {
        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        val model = body.optString("model")
        if (model.isEmpty()) { response.json(400, err("`model` is required.", "missing_model")); return }
        if ((body.optJSONArray("messages")?.length() ?: 0) == 0) {
            response.json(400, err("`messages` must be a non-empty array.", "missing_messages")); return
        }

        val provider = body.optString("provider").ifEmpty { "nim" }
        val (config, configError) = configFor(provider, body)
        if (config == null) {
            response.json(if (provider == "nim") 503 else 400, err(configError!!, "config_error")); return
        }

        val wantsStream = !body.has("stream") || body.optBoolean("stream")

        if (!wantsStream) {
            val result = Upstream.complete(config, body, model)
            val failure = result.error
            if (failure != null && result.content.isEmpty()) {
                response.json(502, err(failure.message, failure.code, failure.retryable)); return
            }
            // A 200 with nothing in it is a failure, not an answer — internal
            // callers parse JSON out of `content`.
            if (result.content.isEmpty() && result.reasoning.isEmpty()) {
                response.json(502, err("$model returned an empty completion. Cold-start models can exceed the timeout on their first call — retry, or pick a smaller model.", "empty_completion", true))
                return
            }
            response.json(
                200,
                JSONObject()
                    .put("content", result.content).put("reasoning", result.reasoning)
                    .put("model", model).put("provider", provider).toString()
            )
            return
        }

        response.beginStream()
        response.frame(JSONObject().put("type", "meta").put("provider", provider).put("model", model).toString())

        Upstream.stream(config, body, model) { frame ->
            val json = when (frame) {
                is Upstream.Frame.Delta -> JSONObject().put("type", "delta").put("delta", frame.text)
                is Upstream.Frame.Reasoning -> JSONObject().put("type", "reasoning").put("delta", frame.text)
                is Upstream.Frame.Usage -> JSONObject().put("type", "usage").apply {
                    frame.prompt?.let { put("promptTokens", it) }
                    frame.completion?.let { put("completionTokens", it) }
                    frame.total?.let { put("totalTokens", it) }
                }
                is Upstream.Frame.Done -> JSONObject().put("type", "done").apply {
                    frame.finishReason?.let { put("finishReason", it) }
                }
                is Upstream.Frame.Err -> JSONObject().put("type", "error")
                    .put("message", frame.info.message)
                    .put("code", frame.info.code)
                    .put("retryable", frame.info.retryable)
            }
            runCatching { response.frame(json.toString()) }
        }

        runCatching { response.endStream() }
    }

    // ── /api/image ──────────────────────────────────────────────────────────

    private fun image(request: ApiRequest, response: ResponseWriter) {
        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        val prompt = body.optString("prompt").trim()
        if (prompt.isEmpty()) { response.json(400, err("`prompt` is required.", "missing_prompt")); return }

        val provider = body.optString("provider").ifEmpty { "pollinations" }
        if (provider == "nim" && nimKey.isEmpty()) {
            response.json(503, err("No NVIDIA NIM key configured. Switch the image provider to Pollinations — it needs no key.", "nim_key_missing"))
            return
        }

        val width = body.optInt("width", 1024)
        val height = body.optInt("height", 1024)
        val count = body.optInt("count", 1).coerceIn(1, 4)
        val baseSeed = if (body.has("seed")) body.optInt("seed") else (Math.random() * Int.MAX_VALUE).toInt()

        val images = JSONArray()
        val errors = JSONArray()

        for (i in 0 until count) {
            val seed = baseSeed + i
            val result = when (provider) {
                "nim" -> Nim.generateImage(
                    nimKey,
                    body.optString("model").ifEmpty { "black-forest-labs/flux.1-dev" },
                    prompt, width, height, seed, body.optInt("steps", 50),
                ).map { it.first to it.second }
                else -> Pollinations.generateImage(prompt, body.optString("model").ifEmpty { "flux" }, width, height, seed)
                    .map { it to seed }
            }

            result.onSuccess { (dataUrl, usedSeed) ->
                images.put(
                    JSONObject().put("dataUrl", dataUrl)
                        .put("model", body.optString("model").ifEmpty { if (provider == "nim") "black-forest-labs/flux.1-dev" else "flux" })
                        .put("seed", usedSeed)
                )
            }.onFailure { errors.put(it.message ?: "generation failed") }
        }

        if (images.length() == 0) {
            response.json(502, JSONObject()
                .put("error", errors.optString(0, "Image generation failed."))
                .put("errors", errors).put("provider", provider)
                .put("code", "image_generation_failed").toString())
            return
        }

        response.json(200, JSONObject()
            .put("images", images).put("errors", errors)
            .put("provider", provider).put("prompt", prompt).toString())
    }

    // ── /api/endpoints/probe ────────────────────────────────────────────────

    private val routeCapabilities = listOf(
        "/images/generations" to "image",
        "/videos/generations" to "video",
        "/audio/speech" to "audio",
        "/3d/generations" to "model3d",
        "/embeddings" to "embedding",
    )

    private fun probe(request: ApiRequest, response: ResponseWriter) {
        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        // A pasted endpoint is not a base. People copy the URL out of the docs —
        // ".../v1/models", ".../v1/chat/completions" — and taking it literally
        // makes the probe ask for "/v1/models/models", then blames the endpoint.
        val raw = body.optString("baseUrl")
        var base = EndpointProbe.normalizeBase(raw)
        if (base.isEmpty()) { response.json(400, err("`baseUrl` is required.", "missing_base_url")); return }

        val host = runCatching { URL(base).host }.getOrNull()
        if (host == null) {
            response.json(422, JSONObject().put("ok", false).put("baseUrl", base).put("error", "\"$base\" is not a valid URL.").toString()); return
        }
        if (host == "169.254.169.254" || host == "metadata.google.internal") {
            response.json(403, JSONObject().put("ok", false).put("baseUrl", base).put("error", "That host is blocked (cloud metadata endpoint).").toString()); return
        }

        // Only the user's own headers here. Which auth header the key belongs in
        // depends on the dialect, and putting a Bearer token on an Anthropic or
        // Gemini request is a 401 — the auth header is added once the protocol
        // is known, below.
        val headers = mutableMapOf<String, String>()
        body.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.optString(k) } }
        val apiKey = body.optString("apiKey")

        val started = System.currentTimeMillis()
        val capabilities = linkedSetOf<String>()
        val routes = JSONArray()
        val models = JSONArray()

        // 0. Which protocol this endpoint actually speaks.
        //
        // Only one of three is OpenAI's. An Anthropic gateway serves
        // /v1/messages and reads x-api-key; Gemini puts the model in the path
        // and reads x-goog-api-key. Asking either in OpenAI's dialect 404s the
        // route or 401s the key, and the endpoint gets blamed for a protocol
        // mismatch.
        // An explicit choice from Settings wins over detection.
        val hinted = body.optString("dialect").takeIf { it.isNotEmpty() && Dialects.ALL.contains(it) }
            ?: Dialects.fromUrl(raw)
        val order = if (hinted != null) listOf(hinted) + Dialects.ALL.filter { it != hinted } else Dialects.ALL

        var dialect = hinted ?: Dialects.OPENAI
        var spoken = false

        for (candidate in order) {
            val candidateBase = Dialects.normalizeBase(raw, candidate)
            val candidateHeaders = headers.toMutableMap().apply {
                if (!Dialects.hasAuthHeader(candidate, this)) putAll(Dialects.authHeaders(candidate, apiKey))
            }
            val answer = speaksDialect(candidate, candidateBase, candidateHeaders)
            if (answer.auth) {
                response.json(422, JSONObject()
                    .put("ok", false).put("baseUrl", candidateBase).put("dialect", candidate)
                    .put("capabilities", JSONArray()).put("models", JSONArray()).put("routes", JSONArray())
                    .put("latencyMs", System.currentTimeMillis() - started)
                    .put("error", "Endpoint rejected the credentials (${answer.status}). Check the API key, or the custom auth header if the endpoint wants its own.")
                    .toString())
                return
            }
            if (!answer.ok) continue
            dialect = candidate
            base = candidateBase
            spoken = true
            routes.put(answer.route)
            break
        }

        if (!Dialects.hasAuthHeader(dialect, headers)) headers.putAll(Dialects.authHeaders(dialect, apiKey))

        // A non-OpenAI endpoint publishes its models at its own path, in its own
        // shape, and none of the OpenAI-shaped fallbacks apply.
        if (dialect != Dialects.OPENAI) {
            val ids = Dialects.modelIdsFromList(
                dialect,
                Upstream.getWithStatus(Dialects.modelListUrl(dialect, base), headers, 15_000).body,
            )
            if (ids.isNotEmpty()) {
                routes.put("/models")
                ids.forEach { id ->
                    val caps = ModelMeta.capabilities(id)
                    capabilities.addAll(caps)
                    models.put(
                        JSONObject().put("id", id).put("provider", "custom")
                            .put("label", ModelMeta.label(id)).put("vendor", ModelMeta.vendor(id))
                            .put("capabilities", JSONArray(caps)).put("origin", "catalogue")
                    )
                }
            }
            capabilities.add("chat")

            val answered = routes.length() > 0
            response.json(
                if (answered) 200 else 422,
                JSONObject()
                    .put("ok", answered).put("baseUrl", base).put("dialect", dialect)
                    .put("capabilities", JSONArray(capabilities.toList()))
                    .put("models", models).put("routes", routes)
                    .put("latencyMs", System.currentTimeMillis() - started)
                    .apply {
                        if (!answered) put(
                            "error",
                            "Nothing answered at $base in the $dialect dialect. Check the base URL and the key; " +
                                "you can still add the endpoint and type the model id by hand."
                        )
                    }
                    .toString()
            )
            return
        }

        // 1. Which base can actually be talked to.
        //
        // The model list and the chat route need not share a prefix — kie.ai
        // serves chat at /v1/chat/completions and lists models at
        // /api/v1/models — so a base derived from one is wrong for the other.
        var chatBase = base
        if (!spoken) {
            findChatBase(base, headers)?.let { found ->
                chatBase = found
                val path = runCatching { URL(found).path }.getOrNull().orEmpty()
                routes.put(if (found == base) "/chat/completions" else "chat at ${path.ifEmpty { "/" }}")
            }
        }

        // 2. The model list. "<base>/models with an OpenAI envelope" is the
        // common case, not the only one, so several paths and several envelopes
        // are accepted.
        var authFailure: Int? = null
        for (candidate in EndpointProbe.modelListCandidates(base)) {
            val result = Upstream.getWithStatus(candidate.url, headers, 15_000)
            // Auth failures are conclusive — stop and report rather than trying
            // every other path and blaming the route.
            if (result.status == 401 || result.status == 403) { authFailure = result.status; break }
            if (result.body == null) continue

            val ids = EndpointProbe.chatModelsOnly(EndpointProbe.modelIdsFrom(result.body))
            if (ids.isEmpty()) continue

            routes.put(candidate.label)
            for (id in ids) {
                val caps = ModelMeta.capabilities(id)
                capabilities.addAll(caps)
                models.put(
                    JSONObject().put("id", id).put("provider", "custom")
                        .put("label", ModelMeta.label(id)).put("vendor", ModelMeta.vendor(id))
                        .put("capabilities", JSONArray(caps))
                        .put("origin", "catalogue")
                )
            }
            break
        }

        if (authFailure != null) {
            response.json(422, JSONObject()
                .put("ok", false).put("baseUrl", base)
                .put("capabilities", JSONArray()).put("models", JSONArray()).put("routes", JSONArray())
                .put("latencyMs", System.currentTimeMillis() - started)
                .put("error", "Endpoint rejected the credentials ($authFailure). Check the API key or custom auth header.")
                .toString())
            return
        }

        // 3. Route sniffing for modalities /models does not always advertise.
        routeCapabilities.forEach { (path, capability) ->
            val status = runCatching {
                val conn = (URL("$chatBase$path").openConnection() as HttpURLConnection).apply {
                    requestMethod = "OPTIONS"; connectTimeout = 8_000; readTimeout = 8_000
                    headers.forEach { (k, v) -> setRequestProperty(k, v) }
                }
                try { conn.responseCode } finally { conn.disconnect() }
            }.getOrNull() ?: return@forEach

            // 404/501 means absent. Anything else (400/405/422 included) proves
            // the handler is mounted.
            if (status != 404 && status != 501) {
                capabilities.add(capability)
                routes.put(path)
            }
        }

        if (routes.length() > 0) capabilities.add("chat")

        val ok = routes.length() > 0
        response.json(
            if (ok) 200 else 422,
            JSONObject()
                .put("ok", ok).put("baseUrl", chatBase).put("dialect", dialect)
                .put("capabilities", JSONArray(capabilities.toList()))
                .put("models", models).put("routes", routes)
                .put("latencyMs", System.currentTimeMillis() - started)
                .apply {
                    if (!ok) put(
                        "error",
                        "Nothing answered at $base — no model list on /models or /api/v1/models, and no chat route. " +
                            "Check the base URL and the key; you can still add the endpoint and type the model id by hand."
                    )
                }
                .toString()
        )
    }

    private data class Spoken(val ok: Boolean, val route: String, val status: Int = 0, val auth: Boolean = false)

    /**
     * Whether an endpoint answers in a given dialect.
     *
     * Existence is inferred from the refusal, not from a successful completion:
     * 404/405/501 means the route is not there, and anything else — a 400 about
     * the model, a 422 about the id — means it is. 401/403 is conclusive the
     * other way: the route exists and the credentials were refused, which is
     * worth saying rather than trying two more protocols and blaming the URL.
     */
    private fun speaksDialect(dialect: String, base: String, headers: Map<String, String>): Spoken {
        val probeModel = if (dialect == Dialects.GEMINI) "gemini-3-flash" else "__chomugiri_probe__"
        val url = Dialects.chatUrl(dialect, base, probeModel, false)

        val payload = when (dialect) {
            Dialects.ANTHROPIC -> JSONObject()
                .put("model", probeModel).put("max_tokens", 1)
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi")))
            Dialects.GEMINI -> JSONObject().put(
                "contents",
                JSONArray().put(
                    JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", "hi")))
                )
            )
            else -> JSONObject()
                .put("model", probeModel).put("max_tokens", 1)
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi")))
        }.toString()

        val result = runCatching {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true
                connectTimeout = 10_000; readTimeout = 12_000
                setRequestProperty("Content-Type", "application/json")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            try {
                conn.outputStream.use { it.write(payload.toByteArray()) }
                val status = conn.responseCode
                val text = runCatching {
                    (if (status in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { r -> r.readText() }
                }.getOrNull().orEmpty()
                status to text
            } finally { conn.disconnect() }
        }.getOrNull() ?: return Spoken(false, "")

        val (status, text) = result
        if (status == 401 || status == 403) return Spoken(false, "", status, auth = true)
        if (status == 404 || status == 405 || status == 501) return Spoken(false, "")

        // Some gateways answer 200 with the error in the body; a "no route"
        // message there means the same as a 404.
        if (status in 200..299 &&
            Regex("not supported|no route|not found", RegexOption.IGNORE_CASE).containsMatchIn(text) &&
            Regex("\"code\"\\s*:\\s*(404|501)").containsMatchIn(text)
        ) return Spoken(false, "")

        val path = runCatching { URL(url).path }.getOrNull().orEmpty()
        return Spoken(true, if (dialect == Dialects.OPENAI) "/chat/completions" else "$dialect at $path")
    }

    /**
     * The base whose `/chat/completions` exists.
     *
     * Existence is inferred from the refusal: 404 or 501 means the route is not
     * there, and anything else — a 400 about the model, a 422 about the id —
     * means it is. Deliberately generous: the point is to find the route, not to
     * make a successful completion at probe time.
     */
    private fun findChatBase(base: String, headers: Map<String, String>): String? {
        for (candidate in EndpointProbe.chatBaseCandidates(base)) {
            val payload = JSONObject()
                .put("model", "__chomugiri_probe__")
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi")))
                .put("max_tokens", 1)
                .toString()

            val result = runCatching {
                val conn = (URL("$candidate/chat/completions").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; doOutput = true
                    connectTimeout = 10_000; readTimeout = 12_000
                    setRequestProperty("Content-Type", "application/json")
                    headers.forEach { (k, v) -> setRequestProperty(k, v) }
                }
                try {
                    conn.outputStream.use { it.write(payload.toByteArray()) }
                    val status = conn.responseCode
                    val text = runCatching {
                        (if (status in 200..299) conn.inputStream else conn.errorStream)
                            ?.bufferedReader()?.use { r -> r.readText() }
                    }.getOrNull().orEmpty()
                    status to text
                } finally { conn.disconnect() }
            }.getOrNull() ?: continue

            val (status, text) = result
            if (status == 404 || status == 501) continue

            // Some gateways answer 200 with the error in the body; a "no route"
            // message there means the same as a 404.
            if (status in 200..299 &&
                Regex("not supported|no route|not found", RegexOption.IGNORE_CASE).containsMatchIn(text) &&
                Regex("\"code\"\\s*:\\s*(404|501)").containsMatchIn(text)
            ) continue

            return candidate
        }
        return null
    }


    // ── /api/bridge/proxy ───────────────────────────────────────────────────

    private fun bridgeProxy(request: ApiRequest, response: ResponseWriter) {
        val base = request.headers["x-bridge-url"]?.trim()?.trimEnd('/')
        val token = request.headers["x-bridge-token"]?.trim()
        val path = request.param("path")

        if (base.isNullOrEmpty() || token.isNullOrEmpty()) {
            response.json(400, err("X-Bridge-Url and X-Bridge-Token headers are required.", "missing_bridge_headers")); return
        }
        if (path == null || !path.startsWith("/v1/")) {
            response.json(400, err("The `path` parameter must start with /v1/.", "bad_path")); return
        }

        val isStream = path.startsWith("/v1/stream/")
        val conn = runCatching {
            (URL("$base$path").openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 15_000
                readTimeout = if (isStream) 0 else 120_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("ngrok-skip-browser-warning", "true")
                if (request.method == "POST") {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
        }.getOrElse {
            response.json(502, err("Bridge unreachable: ${it.message}", "bridge_offline", true)); return
        }

        try {
            if (request.method == "POST") conn.outputStream.use { it.write(request.body) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream

            if (isStream && status in 200..299) {
                response.beginStream()
                stream?.bufferedReader()?.use { reader ->
                    reader.forEachLine { line ->
                        if (line.startsWith("data:")) {
                            runCatching { response.frame(line.removePrefix("data:").trim()) }
                        }
                    }
                }
                runCatching { response.endStream() }
            } else {
                val bytes = stream?.readBytes() ?: ByteArray(0)
                response.bytes(status, conn.contentType ?: "application/json", bytes)
            }
        } catch (e: Exception) {
            runCatching { response.json(502, err("Bridge relay failed: ${e.message}", "bridge_relay_failed", true)) }
        } finally {
            runCatching { conn.disconnect() }
        }
    }

    // ── /api/vercel/deploy ──────────────────────────────────────────────────

    private fun vercelDeploy(request: ApiRequest, response: ResponseWriter) {
        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        val token = body.optString("token").trim()
        val files = body.optJSONArray("files") ?: JSONArray()
        if (token.isEmpty()) {
            response.json(400, err("A Vercel personal access token is required. Create one at vercel.com/account/tokens.", "deploy_precheck_failed")); return
        }
        if (files.length() == 0) {
            response.json(400, err("No files to deploy — generate the frontend artifacts first.", "deploy_precheck_failed")); return
        }

        // Catch an entry-point-less bundle before uploading megabytes of it.
        val entryPattern = Regex("^(index\\.html|public/index\\.html|package\\.json|app/page\\.(t|j)sx?|pages/index\\.(t|j)sx?|src/app/page\\.(t|j)sx?)$")
        val hasEntry = (0 until files.length()).any { entryPattern.matches(files.optJSONObject(it)?.optString("path").orEmpty()) }
        if (!hasEntry) {
            response.json(400, err("No entry point found (index.html or package.json at the bundle root). Vercel would deploy an empty site.", "deploy_precheck_failed")); return
        }

        val name = body.optString("name").lowercase().replace(Regex("[^a-z0-9._-]+"), "-").trim('-', '.', '_')
            .ifEmpty { "chomugiri-" + java.lang.Long.toString(System.currentTimeMillis(), 36) }

        val payloadFiles = JSONArray()
        for (i in 0 until files.length()) {
            val f = files.optJSONObject(i) ?: continue
            payloadFiles.put(
                JSONObject()
                    .put("file", f.optString("path").removePrefix("./"))
                    .put("data", f.optString("content"))
                    .put("encoding", if (f.optString("encoding") == "base64") "base64" else "utf-8")
            )
        }

        val payload = JSONObject()
            .put("name", name)
            .put("files", payloadFiles)
            .put("target", body.optString("target").ifEmpty { "production" })
            .put("projectSettings", JSONObject().put("framework", JSONObject.NULL))

        val teamId = body.optString("teamId")
        val url = "https://api.vercel.com/v13/deployments" + if (teamId.isNotEmpty()) "?teamId=$teamId" else ""

        val conn = runCatching {
            (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true
                connectTimeout = 20_000; readTimeout = 180_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
        }.getOrElse {
            response.json(502, err("Cannot reach api.vercel.com: ${it.message}", "vercel_unreachable", true)); return
        }

        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }

            if (status !in 200..299 || json.optString("id").isEmpty()) {
                val message = json.optJSONObject("error")?.optString("message")
                    ?: "Vercel returned $status."
                response.json(if (status >= 400) status else 502, err(message, "vercel_deploy_failed")); return
            }

            val host = json.optString("url")
            response.json(200, JSONObject()
                .put("deploymentId", json.optString("id"))
                .put("url", if (host.isNotEmpty()) "https://$host" else JSONObject.NULL)
                .put("inspectorUrl", json.optString("inspectorUrl").takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
                .put("project", name)
                .put("readyState", json.optString("readyState").ifEmpty { "QUEUED" })
                .put("fileCount", payloadFiles.length())
                .put("pending", true)
                .put("note", "Build queued. Track it in the Vercel inspector — the app does not hold the connection open on mobile.")
                .toString())
        } catch (e: Exception) {
            response.json(502, err("Deployment failed: ${e.message}", "vercel_deploy_failed", true))
        } finally {
            runCatching { conn.disconnect() }
        }
    }

    // ── /api/research ───────────────────────────────────────────────────────

    private fun research(request: ApiRequest, response: ResponseWriter) {
        val body = runCatching { JSONObject(request.bodyText) }.getOrElse {
            response.json(400, err("Request body is not valid JSON.", "bad_json")); return
        }

        val query = body.optString("query").trim()
        if (query.isEmpty()) { response.json(400, err("`query` is required.", "missing_query")); return }

        val maxSources = body.optInt("maxSources", 6).coerceIn(1, 12)
        val maxChunks = body.optInt("maxChunks", 14).coerceIn(3, 40)
        val notes = JSONArray()

        val explicit = body.optJSONArray("urls")
        val hits = if (explicit != null && explicit.length() > 0) {
            notes.put("Using ${explicit.length()} caller-supplied URL(s); search skipped.")
            (0 until minOf(explicit.length(), maxSources)).map { Search.Hit(explicit.optString(it), explicit.optString(it), "") }
        } else {
            val outcome = Search.run(query, maxSources * 2)
            notes.put("Search via ${outcome.provider} — ${outcome.summary}")
            outcome.hits
        }

        if (hits.isEmpty()) {
            response.json(502, err("Every search backend refused or returned nothing. Free search surfaces rate-limit aggressively — pass explicit `urls`, or retry.", "search_empty", true))
            return
        }

        val pages = hits.take(maxSources * 2).mapNotNull { Search.fetchPage(it.url) }.take(maxSources)
        if (pages.isEmpty()) {
            response.json(502, err("Every candidate source failed to fetch or was non-HTML.", "fetch_all_failed")); return
        }

        data class Passage(val text: String, val url: String, val title: String, var score: Double)
        val passages = mutableListOf<Passage>()
        pages.forEach { page ->
            Search.chunk(page.text).take(40).forEach { passages.add(Passage(it, page.url, page.title, 0.0)) }
        }

        val key = nimKey
        var ranked: List<Passage>

        val embedded = if (key.isNotEmpty()) {
            val shortlist = passages.take(80)
            val queryVec = Nim.embed(key, listOf(query), "query")
            val passageVecs = if (queryVec != null) Nim.embed(key, shortlist.map { it.text }, "passage") else null
            if (queryVec != null && passageVecs != null && passageVecs.first.size == shortlist.size) {
                shortlist.forEachIndexed { i, p -> p.score = Search.cosine(queryVec.first[0], passageVecs.first[i]) }
                notes.put("Ranked by embedding similarity (${passageVecs.second}).")
                shortlist.sortedByDescending { it.score }.take(maxChunks)
            } else null
        } else null

        if (embedded != null) {
            ranked = embedded
        } else {
            notes.put(if (key.isEmpty()) "No NIM key — using lexical ranking. Add a key for semantic ranking."
                      else "NIM embeddings unavailable — fell back to lexical ranking.")
            passages.forEach { it.score = Search.lexicalScore(query, it.text) }
            ranked = passages.sortedByDescending { it.score }.take(maxChunks)
        }

        val order = ranked.map { it.url }.distinct()
        val context = ranked.joinToString("\n\n---\n\n") { "[${order.indexOf(it.url) + 1}] ${it.title}\n${it.text}" }

        val sources = JSONArray()
        order.forEachIndexed { i, url ->
            val best = ranked.firstOrNull { it.url == url }
            sources.put(
                JSONObject().put("n", i + 1).put("url", url)
                    .put("title", pages.firstOrNull { it.url == url }?.title ?: url)
                    .put("score", best?.score ?: 0.0)
                    .put("excerpt", best?.text?.take(280).orEmpty())
            )
        }

        response.json(200, JSONObject()
            .put("query", query).put("context", context)
            .put("notes", notes).put("sources", sources)
            .put("stats", JSONObject().put("pagesFetched", pages.size).put("passages", passages.size).put("selected", ranked.size))
            .toString())
    }
}
