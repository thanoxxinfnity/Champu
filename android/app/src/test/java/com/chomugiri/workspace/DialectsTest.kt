package com.chomugiri.workspace

import com.chomugiri.workspace.providers.Dialects
import com.chomugiri.workspace.providers.Upstream
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * The APK answers /api/chat itself, so these are the translations the phone
 * actually runs — not the TypeScript ones. Two of them are exercised against
 * servers that speak the real protocols, because a translation that only passes
 * unit tests is exactly what shipped before.
 */
class DialectsTest {

    @Test fun `the pasted URL announces the protocol`() {
        // The one from the screenshot: an Anthropic gateway asked in OpenAI's
        // dialect is what produced "nothing answered".
        assertEquals(Dialects.ANTHROPIC, Dialects.fromUrl("https://tabitoken.com/v1/messages"))
        assertEquals(Dialects.GEMINI, Dialects.fromUrl("https://generativelanguage.googleapis.com/v1beta"))
        assertEquals(Dialects.OPENAI, Dialects.fromUrl("https://api.kie.ai/v1"))
        assertNull(Dialects.fromUrl("https://example.com/"))
    }

    @Test fun `a pasted endpoint is reduced to the base its dialect builds from`() {
        assertEquals("https://tabitoken.com/v1", Dialects.normalizeBase("https://tabitoken.com/v1/messages", Dialects.ANTHROPIC))
        assertEquals("https://tabitoken.com/v1", Dialects.normalizeBase("https://tabitoken.com", Dialects.ANTHROPIC))
        assertEquals(
            "https://g.com/v1beta",
            Dialects.normalizeBase("https://g.com/v1beta/models/gemini-3-pro:generateContent", Dialects.GEMINI),
        )
    }

    @Test fun `each dialect gets its own route and auth header`() {
        assertEquals("https://a/v1/messages", Dialects.chatUrl(Dialects.ANTHROPIC, "https://a/v1", "m", true))
        assertEquals(
            "https://a/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse",
            Dialects.chatUrl(Dialects.GEMINI, "https://a/v1beta", "models/gemini-3-pro", true),
        )
        assertEquals(mapOf("x-api-key" to "k", "anthropic-version" to "2023-06-01"), Dialects.authHeaders(Dialects.ANTHROPIC, "k"))
        assertEquals(mapOf("x-goog-api-key" to "k"), Dialects.authHeaders(Dialects.GEMINI, "k"))
        assertEquals(mapOf("Authorization" to "Bearer k"), Dialects.authHeaders(Dialects.OPENAI, "k"))
    }

    private fun request() = JSONObject()
        .put("maxTokens", 100)
        .put(
            "messages",
            JSONArray()
                .put(JSONObject().put("role", "system").put("content", "be brief"))
                .put(JSONObject().put("role", "user").put("content", "hi"))
                .put(JSONObject().put("role", "assistant").put("content", "hello")),
        )

    @Test fun `Anthropic takes system separately and always sends max_tokens`() {
        val body = Dialects.requestBody(Dialects.ANTHROPIC, request(), "claude-opus-5", true)
        assertEquals("be brief", body.optString("system"))
        assertEquals(100, body.optInt("max_tokens"))
        assertEquals(2, body.optJSONArray("messages")!!.length())
        // Omitting max_tokens is a 400 on Anthropic.
        assertTrue(Dialects.requestBody(Dialects.ANTHROPIC, JSONObject(), "m", false).optInt("max_tokens") > 0)
    }

    @Test fun `Gemini renames everything - contents, parts, and the model role`() {
        val body = Dialects.requestBody(Dialects.GEMINI, request(), "gemini-3-pro", true)
        val contents = body.optJSONArray("contents")!!
        assertEquals("user", contents.optJSONObject(0)!!.optString("role"))
        assertEquals("model", contents.optJSONObject(1)!!.optString("role"))
        assertEquals("hi", contents.optJSONObject(0)!!.optJSONArray("parts")!!.optJSONObject(0)!!.optString("text"))
        assertEquals("be brief", body.optJSONObject("systemInstruction")!!.optJSONArray("parts")!!.optJSONObject(0)!!.optString("text"))
        assertEquals(100, body.optJSONObject("generationConfig")!!.optInt("maxOutputTokens"))
        assertTrue("the model goes in the path, not the body", body.optString("model").isEmpty())
    }

    @Test fun `Anthropic SSE events carry their meaning in the event type`() {
        val seen = mutableListOf<Upstream.Frame>()
        Dialects.framesFromStreamChunk(
            Dialects.ANTHROPIC,
            JSONObject("""{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}"""),
        ) { seen += it }
        assertEquals("Hi", (seen.single() as Upstream.Frame.Delta).text)

        seen.clear()
        Dialects.framesFromStreamChunk(Dialects.ANTHROPIC, JSONObject("""{"type":"message_start","message":{}}""")) { seen += it }
        assertTrue("message_start carries nothing to show", seen.isEmpty())

        seen.clear()
        Dialects.framesFromStreamChunk(Dialects.ANTHROPIC, JSONObject("""{"type":"message_stop"}""")) { seen += it }
        assertTrue(seen.single() is Upstream.Frame.Done)
    }

    @Test fun `model lists are read in each dialect's shape`() {
        assertEquals(listOf("claude-opus-5"), Dialects.modelIdsFromList(Dialects.ANTHROPIC, """{"data":[{"id":"claude-opus-5"}]}"""))
        assertEquals(listOf("gemini-3-pro"), Dialects.modelIdsFromList(Dialects.GEMINI, """{"models":[{"name":"models/gemini-3-pro"}]}"""))
    }

    // ── End to end, against servers that speak the real protocols ───────────

    /** What one request looked like, and what the stub should answer with. */
    private data class Seen(var path: String = "", var query: String? = null, var headers: Map<String, String> = emptyMap(), var body: String = "")

    /**
     * A stub that speaks raw HTTP.
     *
     * com.sun.net.httpserver is not on the Android unit-test classpath, and the
     * point here is the bytes on the wire anyway.
     */
    private fun serve(status: Int, contentType: String, payload: String): Triple<ServerSocket, Int, Seen> {
        val socket = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val seen = Seen()

        thread(isDaemon = true) {
            runCatching {
                socket.accept().use { client ->
                    val reader = BufferedReader(InputStreamReader(client.getInputStream()))
                    val requestLine = reader.readLine().orEmpty()
                    val target = requestLine.split(" ").getOrElse(1) { "" }
                    seen.path = target.substringBefore('?')
                    seen.query = target.substringAfter('?', "").ifEmpty { null }

                    val headers = mutableMapOf<String, String>()
                    var line = reader.readLine()
                    while (!line.isNullOrEmpty()) {
                        val name = line.substringBefore(':').trim().lowercase()
                        headers[name] = line.substringAfter(':').trim()
                        line = reader.readLine()
                    }
                    seen.headers = headers

                    val length = headers["content-length"]?.toIntOrNull() ?: 0
                    if (length > 0) {
                        val buffer = CharArray(length)
                        var read = 0
                        while (read < length) {
                            val n = reader.read(buffer, read, length - read)
                            if (n <= 0) break
                            read += n
                        }
                        seen.body = String(buffer, 0, read)
                    }

                    val bytes = payload.toByteArray()
                    client.getOutputStream().apply {
                        write(
                            ("HTTP/1.1 $status OK\r\n" +
                                "Content-Type: $contentType\r\n" +
                                "Content-Length: ${bytes.size}\r\n" +
                                "Connection: close\r\n\r\n").toByteArray()
                        )
                        write(bytes)
                        flush()
                    }
                }
            }
        }
        return Triple(socket, socket.localPort, seen)
    }

    private fun collect(cfg: Upstream.Config, model: String): Pair<String, String?> {
        val text = StringBuilder()
        var error: String? = null
        Upstream.stream(cfg, JSONObject().put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi"))), model) { frame ->
            when (frame) {
                is Upstream.Frame.Delta -> text.append(frame.text)
                is Upstream.Frame.Err -> error = frame.info.message
                else -> Unit
            }
        }
        return text.toString() to error
    }

    @Test fun anthropicEndpointAnswersEndToEnd() {
        val sse =
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Namaste\"}}\n\n" +
                "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\" bro\"}}\n\n" +
                "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        val (socket, port, seen) = serve(200, "text/event-stream", sse)

        try {
            val base = Dialects.normalizeBase("http://127.0.0.1:$port/v1/messages", Dialects.ANTHROPIC)
            val cfg = Upstream.Config(
                url = Dialects.chatUrl(Dialects.ANTHROPIC, base, "claude-opus-5", true),
                headers = Dialects.authHeaders(Dialects.ANTHROPIC, "secret"),
                dialect = Dialects.ANTHROPIC,
            )
            val (text, error) = collect(cfg, "claude-opus-5")

            assertNull(error)
            assertEquals("Namaste bro", text)
            // The pasted /v1/messages is not doubled, and the key is where
            // Anthropic reads it — not on Authorization.
            assertEquals("/v1/messages", seen.path)
            assertEquals("secret", seen.headers["x-api-key"])
            assertEquals("2023-06-01", seen.headers["anthropic-version"])
            assertTrue("max_tokens is always sent", JSONObject(seen.body).optInt("max_tokens") > 0)
        } finally { socket.close() }
    }

    @Test fun geminiEndpointAnswersEndToEnd() {
        val sse =
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Kaise\"}],\"role\":\"model\"}}]}\n\n" +
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" ho\"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}]}\n\n"
        val (socket, port, seen) = serve(200, "text/event-stream", sse)

        try {
            val base = "http://127.0.0.1:$port/v1beta"
            val cfg = Upstream.Config(
                url = Dialects.chatUrl(Dialects.GEMINI, base, "gemini-3-pro", true),
                headers = Dialects.authHeaders(Dialects.GEMINI, "g-key"),
                dialect = Dialects.GEMINI,
                urlFor = { stream -> Dialects.chatUrl(Dialects.GEMINI, base, "gemini-3-pro", stream) },
            )
            val (text, error) = collect(cfg, "gemini-3-pro")

            assertNull(error)
            assertEquals("Kaise ho", text)
            assertEquals("/v1beta/models/gemini-3-pro:streamGenerateContent", seen.path)
            assertEquals("alt=sse", seen.query)
            assertEquals("g-key", seen.headers["x-goog-api-key"])
            assertTrue("messages are translated to contents", JSONObject(seen.body).has("contents"))
        } finally { socket.close() }
    }

    @Test fun anthropicErrorEnvelopeIsReported() {
        val (socket, port, _) = serve(
            400,
            "application/json",
            """{"type":"error","error":{"type":"invalid_request_error","message":"model: claude-opus-9 not found"}}""",
        )
        try {
            val cfg = Upstream.Config(
                url = "http://127.0.0.1:$port/v1/messages",
                headers = Dialects.authHeaders(Dialects.ANTHROPIC, "k"),
                dialect = Dialects.ANTHROPIC,
            )
            val (_, error) = collect(cfg, "claude-opus-9")
            assertTrue("reported: $error", error!!.contains("claude-opus-9 not found"))
        } finally { socket.close() }
    }
}

/**
 * A 403 from a firewall is not a 403 from the API, and the difference decides
 * whether the user goes hunting for a key problem that does not exist.
 */
class BlockedTest {

    // The real page tabitoken.com answers with, trimmed.
    private val cloudflare = """
        <!DOCTYPE html><html lang="en-US"><head><title>Attention Required! | Cloudflare</title></head>
        <body><h1>Sorry, you have been blocked</h1><h2>You are unable to access tabitoken.com</h2>
        <span>Cloudflare Ray ID: a3acf1728b172d28</span></body></html>
    """.trimIndent()

    @Test fun `a Cloudflare block page is not an API key problem`() {
        val info = com.chomugiri.workspace.providers.Blocked.detect(
            403,
            mapOf("Content-Type" to "text/html; charset=UTF-8", "Server" to "cloudflare", "CF-RAY" to "a3acf1728b172d28"),
            cloudflare,
        )
        assertEquals("Cloudflare", info!!.service)
        assertEquals("a3acf1728b172d28", info.reference)
        assertTrue(info.message.contains("not your API key"))
        // The reference is what the endpoint's support actually needs.
        assertTrue(info.message.contains("a3acf1728b172d28"))
    }

    @Test fun `the Ray ID is recovered from the page when the header is absent`() {
        val info = com.chomugiri.workspace.providers.Blocked.detect(403, mapOf("Content-Type" to "text/html"), cloudflare)
        assertEquals("a3acf1728b172d28", info!!.reference)
    }

    @Test fun `a JSON error is the API speaking, and is left alone`() {
        assertNull(
            com.chomugiri.workspace.providers.Blocked.detect(
                401,
                mapOf("Content-Type" to "application/json"),
                """{"type":"error","error":{"type":"authentication_error","message":"x-api-key header is required"}}""",
            )
        )
    }

    @Test fun `only refusing statuses are considered`() {
        assertNull(com.chomugiri.workspace.providers.Blocked.detect(200, mapOf("Content-Type" to "text/html"), cloudflare))
        assertNull(com.chomugiri.workspace.providers.Blocked.detect(500, mapOf("Content-Type" to "text/html"), "<html>oops</html>"))
    }
}
