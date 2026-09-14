package com.chomugiri.workspace.providers

/**
 * A request that never reached the API.
 *
 * A 403 has two completely different meanings and both were reported as one:
 * "your key is wrong" and "a security service in front of this endpoint refused
 * the connection". The second is the common one on hosted gateways, and telling
 * that user to check their API key sends them looking in the one place the
 * problem is not.
 *
 * The tell is the body: an API answers JSON, a WAF answers an HTML block page.
 *
 * The Kotlin twin of src/lib/providers/blocked.ts — the APK makes its own
 * outbound requests, so a fix on the web side alone never reaches the phone.
 */
object Blocked {

    /**
     * How Chomugiri identifies itself upstream.
     *
     * HttpURLConnection otherwise sends `Java/<version>`, which a number of
     * WAFs refuse on sight. Identifying honestly is the fix; forging a browser
     * would be evading a control the endpoint chose to run.
     */
    const val USER_AGENT = "Chomugiri/2.8 (Android; +https://github.com/thanoxxinfnity/Champu)"

    data class Info(val service: String, val reference: String?, val message: String)

    private val HTML_START = Regex("""^\s*(<!doctype html|<html[\s>])""", RegexOption.IGNORE_CASE)
    private val RAY_IN_BODY = Regex("""Cloudflare Ray ID:\s*(?:<[^>]*>\s*)*([0-9a-f]{8,})""", RegexOption.IGNORE_CASE)
    private val REFERENCE = Regex("""(?:Request ID|Reference #|Error Id)[:\s]*([\w-]{6,})""", RegexOption.IGNORE_CASE)

    /**
     * Whether this response is a block page rather than an API error.
     *
     * Conservative: an HTML body on a refusing status. A JSON error is always
     * the API speaking for itself, however it is worded.
     */
    fun detect(status: Int, headers: Map<String, String>, body: String): Info? {
        if (status != 403 && status != 401 && status != 503 && status != 429) return null

        fun header(name: String): String =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value.orEmpty()

        val contentType = header("content-type").lowercase()
        val looksHtml = contentType.contains("text/html") || HTML_START.containsMatchIn(body)
        if (!looksHtml) return null

        val server = header("server").lowercase()
        val service = when {
            server.contains("cloudflare") || body.contains("cloudflare", ignoreCase = true) -> "Cloudflare"
            server.contains("akamai") || body.contains("akamai", ignoreCase = true) -> "Akamai"
            server.contains("aws") || body.contains("Request blocked", ignoreCase = true) -> "AWS WAF"
            server.isNotEmpty() -> server
            else -> "a security service"
        }

        val reference = header("cf-ray").ifEmpty { RAY_IN_BODY.find(body)?.groupValues?.get(1).orEmpty() }
            .ifEmpty { REFERENCE.find(body)?.groupValues?.get(1).orEmpty() }
            .ifEmpty { null }

        return Info(
            service,
            reference,
            "Blocked by $service before the request reached the API ($status). This is not your API key — " +
                "the endpoint's own protection refused the connection." +
                (reference?.let { " Reference: $it." } ?: "") +
                " Some providers block anything that is not a desktop browser; if this keeps happening, send that " +
                "reference to the endpoint's support and ask them to allow API clients.",
        )
    }
}
