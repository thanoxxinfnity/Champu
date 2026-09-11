package com.chomugiri.workspace

import com.chomugiri.workspace.server.ApiRouter
import com.chomugiri.workspace.server.AssetSource
import com.chomugiri.workspace.server.HttpServer
import com.chomugiri.workspace.server.SecretStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Exercises the embedded server the way the WebView does — real sockets, real
 * HTTP, real upstream calls when a key is present.
 *
 * Live provider assertions are skipped rather than failed when CHOMUGIRI_NIM_KEY
 * is absent, so the suite stays useful on a machine without credentials.
 */
class ServerTest {

    private class MemoryAssets(private val files: Map<String, String>) : AssetSource {
        override fun open(path: String): InputStream? =
            files[path]?.let { ByteArrayInputStream(it.toByteArray()) }
    }

    private class MemorySecrets(initial: Map<String, String> = emptyMap()) : SecretStore {
        private val map = HashMap(initial)
        override fun get(key: String) = map[key].orEmpty()
        override fun put(key: String, value: String) { map[key] = value }
    }

    private val nimKey: String = System.getenv("CHOMUGIRI_NIM_KEY").orEmpty()

    private fun boot(secrets: SecretStore = MemorySecrets()): Pair<HttpServer, Int> {
        val assets = MemoryAssets(
            mapOf(
                "web/index.html" to "<!doctype html><title>Chomugiri</title><div id=root></div>",
                "web/next/static/chunk.js" to "console.log('chunk')",
            )
        )
        val server = HttpServer(assets, ApiRouter(secrets))
        return server to server.start()
    }

    private fun request(
        port: Int,
        path: String,
        method: String = "GET",
        body: String? = null,
        token: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): Triple<Int, String, Map<String, List<String>>> {
        val conn = (URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 300_000
            token?.let { setRequestProperty("X-Chomugiri-Session", it) }
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        return try {
            body?.let { conn.outputStream.use { os -> os.write(it.toByteArray()) } }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText().orEmpty()
            Triple(code, text, conn.headerFields)
        } finally {
            conn.disconnect()
        }
    }

    // ── Static serving ──────────────────────────────────────────────────────

    @Test fun servesTheShellDocument() {
        val (server, port) = boot()
        try {
            val (code, body, headers) = request(port, "/")
            assertEquals(200, code)
            assertTrue("shell document served", body.contains("Chomugiri"))
            assertTrue("html content type", headers["Content-Type"]?.first()?.contains("text/html") == true)
        } finally { server.stop() }
    }

    @Test fun hashedChunksAreCachedImmutably() {
        val (server, port) = boot()
        try {
            val (code, _, headers) = request(port, "/next/static/chunk.js")
            assertEquals(200, code)
            assertTrue("immutable cache header", headers["Cache-Control"]?.first()?.contains("immutable") == true)
        } finally { server.stop() }
    }

    @Test fun unknownPathFallsBackToTheShell() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(port, "/some/client/route")
            assertEquals(200, code)
            assertTrue("client routing falls back to index", body.contains("Chomugiri"))
        } finally { server.stop() }
    }

    @Test fun traversalIsRejected() {
        val (server, port) = boot()
        try {
            val (code, _, _) = request(port, "/../../etc/passwd")
            assertTrue("traversal blocked, got $code", code == 403 || code == 200)
            // A 200 here means the shell fallback answered, never the file.
            if (code == 200) {
                val (_, body, _) = request(port, "/../../etc/passwd")
                assertTrue("no filesystem content leaked", !body.contains("root:"))
            }
        } finally { server.stop() }
    }

    // ── Session gating ──────────────────────────────────────────────────────

    @Test fun apiRequiresTheSessionToken() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(port, "/api/models")
            assertEquals(403, code)
            assertEquals("bad_session", JSONObject(body).optString("code"))
        } finally { server.stop() }
    }

    @Test fun apiAcceptsTheIssuedToken() {
        val (server, port) = boot()
        try {
            val (code, _, _) = request(port, "/api/models", token = server.sessionToken)
            assertEquals(200, code)
        } finally { server.stop() }
    }

    // ── Contract shape ──────────────────────────────────────────────────────

    @Test fun modelsAlwaysReturnsPollinationsWithoutAKey() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(port, "/api/models", token = server.sessionToken)
            assertEquals(200, code)
            val json = JSONObject(body)
            assertNotNull(json.optJSONArray("models"))
            assertTrue("warns about the missing key",
                json.getJSONArray("warnings").toString().contains("NVIDIA NIM key"))
            assertTrue("pollinations still offered",
                json.getJSONObject("providers").getJSONObject("pollinations").getBoolean("configured"))
        } finally { server.stop() }
    }

    @Test fun chatWithoutAKeyExplainsItself() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(
                port, "/api/chat", "POST",
                """{"provider":"nim","model":"moonshotai/kimi-k3","stream":false,"messages":[{"role":"user","content":"hi"}]}""",
                server.sessionToken,
            )
            assertEquals(503, code)
            assertTrue("actionable message", JSONObject(body).getString("error").contains("Settings"))
        } finally { server.stop() }
    }

    @Test fun probeRejectsMetadataHosts() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(
                port, "/api/endpoints/probe", "POST",
                """{"baseUrl":"http://169.254.169.254/latest"}""",
                server.sessionToken,
            )
            assertEquals(403, code)
            assertTrue(JSONObject(body).getString("error").contains("blocked"))
        } finally { server.stop() }
    }

    @Test fun deployPrechecksBeforeUploading() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(
                port, "/api/vercel/deploy", "POST",
                """{"token":"fake","name":"x","files":[{"path":"src/lib/thing.ts","content":"x"}]}""",
                server.sessionToken,
            )
            assertEquals(400, code)
            assertTrue("entry point checked", JSONObject(body).getString("error").contains("entry point"))
        } finally { server.stop() }
    }

    @Test fun bridgeProxyRejectsNonV1Paths() {
        val (server, port) = boot()
        try {
            val (code, body, _) = request(
                port, "/api/bridge/proxy?path=%2Fetc%2Fpasswd", "GET", null, server.sessionToken,
                mapOf("X-Bridge-Url" to "http://127.0.0.1:1", "X-Bridge-Token" to "t"),
            )
            assertEquals(400, code)
            assertTrue(JSONObject(body).getString("error").contains("/v1/"))
        } finally { server.stop() }
    }

    // ── Live provider calls ─────────────────────────────────────────────────

    @Test fun liveNimCatalogueAndStreaming() {
        if (nimKey.isEmpty()) {
            println("SKIP live NIM tests — set CHOMUGIRI_NIM_KEY to run them")
            return
        }

        val (server, port) = boot(MemorySecrets(mapOf("nim_key" to nimKey)))
        try {
            val (code, body, _) = request(port, "/api/models", token = server.sessionToken)
            assertEquals(200, code)
            val json = JSONObject(body)
            val models = json.getJSONArray("models")
            assertTrue("live catalogue returned models", models.length() > 20)

            val ids = (0 until models.length()).map { models.getJSONObject(it).getString("id") }
            assertTrue("kimi-k3 present", ids.contains("moonshotai/kimi-k3"))
            assertTrue("flux offered for image", ids.contains("black-forest-labs/flux.1-dev"))
            println("live catalogue: ${models.length()} models")

            // Streaming: the SSE frames must match the web gateway contract.
            val conn = (URL("http://127.0.0.1:$port/api/chat").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true
                readTimeout = 180_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Chomugiri-Session", server.sessionToken)
            }
            conn.outputStream.use {
                it.write("""{"provider":"nim","model":"moonshotai/kimi-k3","stream":true,"maxTokens":300,"messages":[{"role":"user","content":"Say OK"}]}""".toByteArray())
            }
            assertEquals(200, conn.responseCode)
            assertTrue("chunked SSE", conn.contentType.contains("event-stream"))

            val types = mutableListOf<String>()
            val content = StringBuilder()
            val reasoning = StringBuilder()
            conn.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (!line.startsWith("data:")) return@forEach
                    val frame = JSONObject(line.removePrefix("data:").trim())
                    types.add(frame.getString("type"))
                    when (frame.getString("type")) {
                        "delta" -> content.append(frame.getString("delta"))
                        "reasoning" -> reasoning.append(frame.getString("delta"))
                    }
                }
            }
            conn.disconnect()

            println("frames: ${types.groupingBy { it }.eachCount()} | content=${content.toString().take(40)} | reasoning=${reasoning.length} chars")
            assertEquals("exactly one terminal frame", 1, types.count { it == "done" })
            assertEquals("meta frame first", "meta", types.first())
            assertTrue("no error frames", !types.contains("error"))
            assertTrue("produced content", content.isNotEmpty())
            assertTrue("reasoning captured for a reasoning model", reasoning.isNotEmpty())
        } finally { server.stop() }
    }

    @Test fun liveNimImage() {
        if (nimKey.isEmpty()) return

        val (server, port) = boot(MemorySecrets(mapOf("nim_key" to nimKey)))
        try {
            val (code, body, _) = request(
                port, "/api/image", "POST",
                """{"provider":"nim","model":"black-forest-labs/flux.1-dev","prompt":"a neon emerald terminal","width":1024,"height":1024,"count":1}""",
                server.sessionToken,
            )
            assertEquals(200, code)
            val image = JSONObject(body).getJSONArray("images").getJSONObject(0)
            val dataUrl = image.getString("dataUrl")
            assertTrue("mime sniffed, not assumed", dataUrl.startsWith("data:image/"))

            val bytes = java.util.Base64.getDecoder().decode(dataUrl.substringAfter(","))
            assertTrue("real image payload", bytes.size > 20_000)
            println("image: ${dataUrl.substringBefore(';')} ${bytes.size} bytes seed=${image.optInt("seed")}")
        } finally { server.stop() }
    }
}

/** The hand-rolled codec must agree with the JDK's, including odd lengths. */
class Base64CodecTest {

    @Test fun roundTripsEveryRemainderCase() {
        val samples = listOf("", "a", "ab", "abc", "abcd", "abcde", "hello chomugiri", "☃ unicode ☃")
        samples.forEach { sample ->
            val encoded = com.chomugiri.workspace.server.Base64Codec.encode(sample.toByteArray())
            assertEquals("encode matches JDK for '$sample'",
                java.util.Base64.getEncoder().encodeToString(sample.toByteArray()), encoded)
            assertEquals("round trip for '$sample'",
                sample, String(com.chomugiri.workspace.server.Base64Codec.decode(encoded)))
        }
    }

    @Test fun decodesBinaryPayloads() {
        val bytes = ByteArray(512) { (it * 7 % 256 - 128).toByte() }
        val encoded = com.chomugiri.workspace.server.Base64Codec.encode(bytes)
        assertTrue("binary round trip", bytes.contentEquals(com.chomugiri.workspace.server.Base64Codec.decode(encoded)))
    }

    @Test fun toleratesUrlSafeAlphabetAndMissingPadding() {
        // Bing's redirect wrapper is url-safe and unpadded.
        val original = "https://developer.nvidia.com/nim?a=1&b=2"
        val urlSafe = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(original.toByteArray())
        assertEquals(original, String(com.chomugiri.workspace.server.Base64Codec.decode(urlSafe)))
    }
}
