package com.chomugiri.workspace.server

import com.chomugiri.workspace.providers.Upstream
import kotlin.math.log
import kotlin.math.sqrt

/**
 * Keyless web search + page extraction for Workdrive.
 *
 * No free search surface has a stable contract — every one rate-limits or serves
 * an anti-bot challenge — so this is a chain, and every attempt is reported so a
 * dead pipeline is diagnosable rather than silent.
 */
object Search {

    private const val BROWSER_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    data class Hit(val url: String, val title: String, val snippet: String)
    data class Outcome(val hits: List<Hit>, val provider: String, val summary: String)
    data class Page(val url: String, val title: String, val text: String)

    private fun decodeEntities(s: String): String = s
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'").replace("&#039;", "'")
        .replace("&nbsp;", " ").replace("&#0183;", "·").replace("&#32;", " ")

    private fun strip(s: String): String =
        decodeEntities(s.replace(Regex("<[^>]+>"), " ")).replace(Regex("\\s+"), " ").trim()

    /** Bing wraps every result in `bing.com/ck/a?...&u=a1<base64url>`. */
    private fun unwrapBing(href: String): String? {
        val raw = decodeEntities(href)
        val match = Regex("[?&]u=([^&]+)").find(raw)
            ?: return if (Regex("^https?://(?!www\\.bing|r\\.bing|th\\.bing)").containsMatchIn(raw)) raw else null

        var payload = match.groupValues[1]
        if (payload.startsWith("a1")) payload = payload.substring(2)
        return runCatching { String(Base64Codec.decode(payload)) }
            .getOrNull()?.takeIf { it.startsWith("http") }
    }

    private fun bing(query: String, limit: Int): List<Hit> {
        val url = "https://www.bing.com/search?q=" + java.net.URLEncoder.encode(query, "UTF-8") + "&count=${minOf(limit * 2, 30)}"
        val html = Upstream.get(url, mapOf("User-Agent" to BROWSER_UA, "Accept" to "text/html", "Accept-Language" to "en-US,en;q=0.9"))
            ?: throw IllegalStateException("request failed")

        val blocks = html.split("<li class=\"b_algo\"").drop(1)
        if (blocks.isEmpty()) throw IllegalStateException("no b_algo blocks — markup changed or challenged")

        val hits = mutableListOf<Hit>()
        for (block in blocks) {
            val anchor = Regex("<h2[^>]*>\\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>").find(block) ?: continue
            val target = unwrapBing(anchor.groupValues[1]) ?: continue
            val snippet = Regex("<p[^>]*>([\\s\\S]*?)</p>").find(block)?.groupValues?.get(1).orEmpty()
            hits.add(Hit(target, strip(anchor.groupValues[2]).take(200), strip(snippet).take(400)))
            if (hits.size >= limit) break
        }
        if (hits.isEmpty()) throw IllegalStateException("blocks present but no links decoded")
        return hits
    }

    private fun duckduckgo(query: String, limit: Int): List<Hit> {
        val conn = (java.net.URL("https://html.duckduckgo.com/html/").openConnection() as java.net.HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true
            connectTimeout = 15_000; readTimeout = 25_000
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            setRequestProperty("User-Agent", BROWSER_UA)
        }
        val html = try {
            conn.outputStream.use { it.write("q=${java.net.URLEncoder.encode(query, "UTF-8")}".toByteArray()) }
            if (conn.responseCode !in 200..299) throw IllegalStateException("HTTP ${conn.responseCode}")
            conn.inputStream.bufferedReader().readText()
        } finally { runCatching { conn.disconnect() } }

        val snippets = Regex("<a[^>]+class=\"result__snippet\"[^>]*>([\\s\\S]*?)</a>")
            .findAll(html).map { strip(it.groupValues[1]) }.toList()

        val hits = mutableListOf<Hit>()
        Regex("<a[^>]+class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>")
            .findAll(html).forEachIndexed { i, m ->
                if (hits.size >= limit) return@forEachIndexed
                var url = decodeEntities(m.groupValues[1])
                Regex("[?&]uddg=([^&]+)").find(url)?.let { url = java.net.URLDecoder.decode(it.groupValues[1], "UTF-8") }
                if (url.startsWith("http")) hits.add(Hit(url, strip(m.groupValues[2]).take(200), snippets.getOrElse(i) { "" }))
            }
        if (hits.isEmpty()) throw IllegalStateException("no result__a anchors — likely a challenge page")
        return hits
    }

    private fun wikipedia(query: String, limit: Int): List<Hit> {
        val url = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
            java.net.URLEncoder.encode(query, "UTF-8") + "&srlimit=${minOf(limit, 10)}&format=json"
        val body = Upstream.get(url, mapOf("User-Agent" to "Chomugiri/1.0 (android research agent)", "Accept" to "application/json"))
            ?: throw IllegalStateException("request failed")

        val search = org.json.JSONObject(body).optJSONObject("query")?.optJSONArray("search")
            ?: throw IllegalStateException("no results array")

        return (0 until search.length()).map { i ->
            val row = search.getJSONObject(i)
            val title = row.optString("title")
            Hit(
                "https://en.wikipedia.org/wiki/" + java.net.URLEncoder.encode(title.replace(' ', '_'), "UTF-8"),
                title,
                strip(row.optString("snippet")),
            )
        }
    }

    fun run(query: String, limit: Int): Outcome {
        val attempts = mutableListOf<String>()
        val chain = listOf<Pair<String, (String, Int) -> List<Hit>>>(
            "bing-html" to ::bing,
            "duckduckgo-html" to ::duckduckgo,
            "wikipedia" to ::wikipedia,
        )

        for ((name, provider) in chain) {
            try {
                val hits = provider(query, limit)
                if (hits.isNotEmpty()) {
                    attempts.add("$name: ${hits.size} hits")
                    return Outcome(hits, name, attempts.joinToString(" · "))
                }
                attempts.add("$name: returned nothing")
            } catch (e: Exception) {
                attempts.add("$name: ${e.message?.take(120)}")
            }
        }
        return Outcome(emptyList(), "none", attempts.joinToString(" · "))
    }

    // ── Page extraction ─────────────────────────────────────────────────────

    fun fetchPage(url: String): Page? {
        val conn = runCatching {
            (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 12_000; readTimeout = 20_000; instanceFollowRedirects = true
                setRequestProperty("User-Agent", BROWSER_UA)
                setRequestProperty("Accept", "text/html,application/xhtml+xml")
            }
        }.getOrNull() ?: return null

        return try {
            if (conn.responseCode !in 200..299) return null
            val type = conn.contentType ?: ""
            if (!Regex("text/html|text/plain|application/xhtml").containsMatchIn(type)) return null

            val raw = conn.inputStream.bufferedReader().readText()
            val title = Regex("<title[^>]*>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE)
                .find(raw)?.groupValues?.get(1)?.let { decodeEntities(it).trim().take(200) }.orEmpty()

            val body = raw
                .replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), " ")
                .replace(Regex("<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), " ")
                .replace(Regex("<(nav|footer|header|noscript)[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE), " ")
                .replace(Regex("<!--[\\s\\S]*?-->"), " ")
                .replace(Regex("</(p|div|section|article|li|h[1-6]|tr|br)>", RegexOption.IGNORE_CASE), "\n")
                .replace(Regex("<[^>]+>"), " ")

            val text = decodeEntities(body)
                .replace(Regex("[ \\t\\u00a0]+"), " ")
                .split('\n').map { it.trim() }.filter { it.length > 2 }
                .joinToString("\n").take(120_000)

            if (text.length < 200) null else Page(url, title.ifEmpty { url }, text)
        } catch (_: Exception) {
            null
        } finally {
            runCatching { conn.disconnect() }
        }
    }

    /** ~900-char chunks on paragraph boundaries, with a little overlap. */
    fun chunk(text: String, size: Int = 900, overlap: Int = 120): List<String> {
        val out = mutableListOf<String>()
        var current = StringBuilder()

        for (paragraph in text.split(Regex("\n{2,}"))) {
            if (current.length + paragraph.length + 2 <= size) {
                if (current.isNotEmpty()) current.append("\n\n")
                current.append(paragraph)
                continue
            }
            if (current.isNotEmpty()) { out.add(current.toString()); current = StringBuilder() }
            if (paragraph.length <= size) {
                current.append(paragraph)
            } else {
                var i = 0
                while (i < paragraph.length) {
                    out.add(paragraph.substring(i, minOf(i + size, paragraph.length)))
                    i += size - overlap
                }
            }
        }
        if (current.isNotEmpty()) out.add(current.toString())
        return out.filter { it.trim().length > 80 }
    }

    fun cosine(a: List<Double>, b: List<Double>): Double {
        var dot = 0.0; var na = 0.0; var nb = 0.0
        for (i in a.indices) {
            val x = a[i]; val y = b.getOrElse(i) { 0.0 }
            dot += x * y; na += x * x; nb += y * y
        }
        val denom = sqrt(na) * sqrt(nb)
        return if (denom == 0.0) 0.0 else dot / denom
    }

    fun lexicalScore(query: String, passage: String): Double {
        val terms = query.lowercase().split(Regex("\\W+")).filter { it.length > 2 }
        if (terms.isEmpty()) return 0.0
        val body = passage.lowercase()
        var score = 0.0
        for (t in terms) {
            val hits = body.split(t).size - 1
            if (hits > 0) score += 1 + log(hits.toDouble(), Math.E)
        }
        return score / terms.size
    }
}
