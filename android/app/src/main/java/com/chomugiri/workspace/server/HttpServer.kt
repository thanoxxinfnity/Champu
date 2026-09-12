package com.chomugiri.workspace.server

import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.PushbackInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Loopback HTTP/1.1 server embedded in the app.
 *
 * Why a server rather than a WebView asset handler: the Chomugiri UI POSTs JSON
 * to `/api` routes and reads Server-Sent Events back. `WebViewClient.shouldInterceptRequest`
 * never exposes a POST body on Android, so intercepting is a dead end. Binding a
 * real socket on 127.0.0.1 and pointing the WebView at it means the web client
 * runs byte-for-byte unchanged — same origin, same fetch calls, same streaming.
 *
 * Bound to loopback only, so nothing outside the device can reach it. A random
 * per-launch token is still required on `/api` routes: other apps on the device share
 * the loopback interface, and without it any of them could drive the user's keys.
 */
class HttpServer(
    private val assets: AssetSource,
    private val router: ApiRouter,
    private val assetRoot: String = "web",
    private val log: (String, Throwable?) -> Unit = { _, _ -> },
) {
    private val running = AtomicBoolean(false)
    private val pool = Executors.newFixedThreadPool(6)
    private var socket: ServerSocket? = null

    /** Random per-launch. The WebView injects it; other processes cannot guess it. */
    val sessionToken: String = buildString {
        val alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        val rnd = java.security.SecureRandom()
        repeat(32) { append(alphabet[rnd.nextInt(alphabet.length)]) }
    }

    var port: Int = 0
        private set

    /**
     * Binds the same port across launches.
     *
     * This is not a preference — it is the difference between the app keeping
     * the user's data and losing it. The workspace is served from
     * http://127.0.0.1:<port>, and every browser storage API is scoped to the
     * origin, which *includes the port*. Binding port 0 handed us a different
     * port on every launch, so every launch was a different origin with its own
     * empty IndexedDB and localStorage: custom endpoints, saved tokens, chat
     * history and even the chosen theme were all silently gone the moment the
     * app was killed. Nothing was deleting them; they were simply being written
     * somewhere the next launch never looked.
     *
     * So: reuse the port that worked last time, and only move if something else
     * has taken it. The candidates are a fixed private-range block rather than
     * the ephemeral range, precisely because the OS does not hand those out at
     * random to other processes.
     */
    private fun bindStablePort(): ServerSocket {
        val loopback = InetAddress.getByName("127.0.0.1")
        val saved = router.servedPort

        val candidates = buildList {
            if (saved in 1024..65535) add(saved)
            // A deterministic block, so a fresh install lands somewhere stable.
            for (offset in 0 until 24) add(BASE_PORT + offset)
        }

        for (candidate in candidates) {
            try {
                val bound = ServerSocket(candidate, 16, loopback)
                if (candidate != saved) router.servedPort = candidate
                return bound
            } catch (_: IOException) {
                // Taken by something else; try the next.
            }
        }

        // Every candidate is occupied. Fall back to an OS-assigned port so the
        // app still runs — this launch will not see the previous launch's data,
        // which is worth saying plainly rather than failing silently.
        log("all stable ports are in use; falling back to an ephemeral port and this session will start with empty local storage", null)
        val fallback = ServerSocket(0, 16, loopback)
        router.servedPort = fallback.localPort
        return fallback
    }

    fun start(): Int {
        if (running.get()) return port

        val server = bindStablePort()
        socket = server
        port = server.localPort
        running.set(true)

        Thread({
            while (running.get()) {
                try {
                    val client = server.accept()
                    pool.execute { handleSafely(client) }
                } catch (e: IOException) {
                    if (running.get()) log("accept failed", e)
                }
            }
        }, "chomugiri-http").apply { isDaemon = true }.start()

        log("listening on 127.0.0.1:$port", null)
        return port
    }

    fun stop() {
        running.set(false)
        runCatching { socket?.close() }
        pool.shutdownNow()
    }

    private fun handleSafely(client: Socket) {
        try {
            client.tcpNoDelay = true
            client.soTimeout = 0
            client.use { handle(it) }
        } catch (e: Exception) {
            log("request failed", e)
        }
    }

    // ── Request parsing ─────────────────────────────────────────────────────

    private fun readLine(input: PushbackInputStream): String {
        val buffer = StringBuilder()
        while (true) {
            val b = input.read()
            if (b == -1) break
            if (b == '\n'.code) break
            if (b != '\r'.code) buffer.append(b.toChar())
        }
        return buffer.toString()
    }

    private fun handle(client: Socket) {
        val input = PushbackInputStream(client.getInputStream().buffered(), 2)
        val output = BufferedOutputStream(client.getOutputStream())

        val requestLine = readLine(input)
        if (requestLine.isBlank()) return

        val parts = requestLine.split(' ')
        if (parts.size < 2) {
            respondText(output, 400, "Bad request line")
            return
        }

        val method = parts[0].uppercase()
        val target = parts[1]

        val headers = HashMap<String, String>()
        while (true) {
            val line = readLine(input)
            if (line.isEmpty()) break
            val colon = line.indexOf(':')
            if (colon > 0) {
                headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
            }
        }

        val body = readBody(input, headers)

        val queryAt = target.indexOf('?')
        val rawPath = if (queryAt == -1) target else target.substring(0, queryAt)
        val query = if (queryAt == -1) "" else target.substring(queryAt + 1)
        val path = URLDecoder.decode(rawPath, "UTF-8")

        when {
            method == "OPTIONS" -> respondText(output, 204, "")

            path.startsWith("/api/") -> {
                if (headers["x-chomugiri-session"] != sessionToken) {
                    respondJson(output, 403, """{"error":"Missing or invalid session token.","code":"bad_session"}""")
                    return
                }
                router.handle(ApiRequest(method, path, query, headers, body), ResponseWriter(output))
            }

            method == "GET" || method == "HEAD" -> serveAsset(path, output, headBodyOnly = method == "HEAD")

            else -> respondText(output, 405, "Method not allowed")
        }

        runCatching { output.flush() }
    }

    private fun readBody(input: InputStream, headers: Map<String, String>): ByteArray {
        headers["content-length"]?.toIntOrNull()?.let { length ->
            if (length <= 0) return ByteArray(0)
            val buffer = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(buffer, read, length - read)
                if (n <= 0) break
                read += n
            }
            return if (read == length) buffer else buffer.copyOf(read)
        }

        if (headers["transfer-encoding"]?.contains("chunked", true) == true) {
            val out = java.io.ByteArrayOutputStream()
            while (true) {
                val sizeLine = StringBuilder()
                while (true) {
                    val b = input.read()
                    if (b == -1 || b == '\n'.code) break
                    if (b != '\r'.code) sizeLine.append(b.toChar())
                }
                val size = sizeLine.toString().trim().substringBefore(';').toIntOrNull(16) ?: 0
                if (size == 0) break
                val chunk = ByteArray(size)
                var read = 0
                while (read < size) {
                    val n = input.read(chunk, read, size - read)
                    if (n <= 0) break
                    read += n
                }
                out.write(chunk, 0, read)
                input.read(); input.read() // trailing CRLF
            }
            return out.toByteArray()
        }

        return ByteArray(0)
    }

    // ── Static assets ───────────────────────────────────────────────────────

    private fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "txt" -> "text/plain; charset=utf-8"
        else -> "application/octet-stream"
    }

    private fun serveAsset(path: String, output: OutputStream, headBodyOnly: Boolean) {
        // Reject traversal before touching the asset manager.
        if (path.contains("..")) {
            respondText(output, 403, "Forbidden")
            return
        }

        val clean = path.trimStart('/').ifEmpty { "index.html" }
        val candidates = listOf(
            "$assetRoot/$clean",
            "$assetRoot/$clean/index.html",
            "$assetRoot/${clean.removeSuffix("/")}.html",
        )

        for (candidate in candidates) {
            val stream = assets.open(candidate) ?: continue
            stream.use {
                val bytes = it.readBytes()
                // Hashed chunk filenames are content-addressed, so they are safe to
                // cache hard. Everything else must revalidate or a republished
                // bundle keeps serving the old page.
                val cache = if (candidate.contains("/next/static/")) "public, max-age=31536000, immutable" else "no-cache"
                respond(output, 200, mimeFor(candidate), if (headBodyOnly) ByteArray(0) else bytes, mapOf("Cache-Control" to cache), bytes.size)
            }
            return
        }

        // Client-side routing: unknown paths fall back to the shell document.
        val fallback = assets.open("$assetRoot/index.html")
        if (fallback != null) {
            fallback.use { respond(output, 200, "text/html; charset=utf-8", it.readBytes()) }
        } else {
            respondText(output, 404, "Not found: $path")
        }
    }

    // ── Response helpers ────────────────────────────────────────────────────

    private fun respond(
        output: OutputStream,
        status: Int,
        contentType: String,
        body: ByteArray,
        extra: Map<String, String> = emptyMap(),
        declaredLength: Int = body.size,
    ) {
        val header = StringBuilder()
        header.append("HTTP/1.1 $status ${statusText(status)}\r\n")
        header.append("Content-Type: $contentType\r\n")
        header.append("Content-Length: $declaredLength\r\n")
        header.append("Connection: close\r\n")
        extra.forEach { (k, v) -> header.append("$k: $v\r\n") }
        header.append("\r\n")

        output.write(header.toString().toByteArray())
        if (body.isNotEmpty()) output.write(body)
        output.flush()
    }

    private fun respondText(output: OutputStream, status: Int, message: String) =
        respond(output, status, "text/plain; charset=utf-8", message.toByteArray())

    private fun respondJson(output: OutputStream, status: Int, json: String) =
        respond(output, status, "application/json; charset=utf-8", json.toByteArray())

    companion object {
        const val TAG = "ChomugiriHttp"

        /**
         * Start of the block the server prefers. Inside IANA's dynamic range but
         * well away from the ephemeral ports Android hands out, so a collision is
         * unlikely and a rebind after one is rare.
         */
        const val BASE_PORT = 47_615

        fun statusText(code: Int): String = when (code) {
            200 -> "OK"; 204 -> "No Content"; 400 -> "Bad Request"; 403 -> "Forbidden"
            404 -> "Not Found"; 405 -> "Method Not Allowed"; 500 -> "Internal Server Error"
            501 -> "Not Implemented"; 502 -> "Bad Gateway"; 503 -> "Service Unavailable"
            else -> "Status $code"
        }
    }
}

data class ApiRequest(
    val method: String,
    val path: String,
    val query: String,
    val headers: Map<String, String>,
    val body: ByteArray,
) {
    val bodyText: String get() = String(body, Charsets.UTF_8)

    fun param(name: String): String? = query.split('&')
        .firstOrNull { it.startsWith("$name=") }
        ?.substringAfter('=')
        ?.let { URLDecoder.decode(it, "UTF-8") }
}

/**
 * Writes a response incrementally so SSE can be forwarded as it arrives rather
 * than buffered to completion — a 60-second reasoning stream must render token by
 * token, not all at once at the end.
 */
class ResponseWriter(private val output: OutputStream) {
    private var headersSent = false

    fun json(status: Int, body: String) {
        val bytes = body.toByteArray()
        sendHeader(status, "application/json; charset=utf-8", bytes.size)
        output.write(bytes)
        output.flush()
    }

    fun bytes(status: Int, contentType: String, body: ByteArray, extra: Map<String, String> = emptyMap()) {
        sendHeader(status, contentType, body.size, extra)
        output.write(body)
        output.flush()
    }

    fun beginStream() {
        sendHeader(
            200,
            "text/event-stream; charset=utf-8",
            null,
            mapOf("Cache-Control" to "no-cache, no-transform", "X-Accel-Buffering" to "no"),
        )
    }

    fun frame(json: String) {
        // Chunked transfer: each SSE frame is its own chunk, flushed immediately.
        val payload = "data: $json\n\n".toByteArray()
        output.write(Integer.toHexString(payload.size).toByteArray())
        output.write("\r\n".toByteArray())
        output.write(payload)
        output.write("\r\n".toByteArray())
        output.flush()
    }

    fun endStream() {
        output.write("0\r\n\r\n".toByteArray())
        output.flush()
    }

    private fun sendHeader(status: Int, contentType: String, length: Int?, extra: Map<String, String> = emptyMap()) {
        if (headersSent) return
        headersSent = true

        val header = StringBuilder()
        header.append("HTTP/1.1 $status ${HttpServer.statusText(status)}\r\n")
        header.append("Content-Type: $contentType\r\n")
        if (length != null) header.append("Content-Length: $length\r\n") else header.append("Transfer-Encoding: chunked\r\n")
        header.append("Connection: close\r\n")
        extra.forEach { (k, v) -> header.append("$k: $v\r\n") }
        header.append("\r\n")

        output.write(header.toString().toByteArray())
        output.flush()
    }
}
