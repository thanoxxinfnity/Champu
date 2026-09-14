package com.chomugiri.workspace

import com.chomugiri.workspace.providers.CustomEndpoint
import com.chomugiri.workspace.providers.Dialects
import com.chomugiri.workspace.providers.ModelCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The typed endpoint config, and the catalogue reader.
 *
 * Each case here is a shape that actually broke something: a camelCase property
 * over a snake_case field, an envelope nobody expected, a protocol a boolean
 * could not express.
 */
class CustomEndpointTest {

    @Test fun `a config decodes, and unknown fields do not break it`() {
        // A config written by an older build must still load.
        val endpoint = CustomEndpoint.parse(
            """{"label":"kie","baseUrl":"https://api.kie.ai/v1","apiKey":"k","somethingNew":42}"""
        ).getOrThrow()

        assertEquals("kie", endpoint.label)
        assertEquals(Dialects.OPENAI, endpoint.resolvedDialect())
    }

    @Test fun `the old isOpenAICompatible flag still loads`() {
        // false used to mean "something else", which is now a dialect to detect
        // rather than a flag — so the URL decides.
        val legacy = CustomEndpoint.parse(
            """{"baseUrl":"https://tabitoken.com/v1/messages","apiKey":"k","isOpenAICompatible":false}"""
        ).getOrThrow()
        assertEquals(Dialects.ANTHROPIC, legacy.resolvedDialect())

        val openai = CustomEndpoint.parse("""{"baseUrl":"https://x.example/v1","isOpenAICompatible":true}""").getOrThrow()
        assertEquals(Dialects.OPENAI, openai.resolvedDialect())
    }

    @Test fun `the auth header follows the dialect`() {
        val anthropic = CustomEndpoint(baseUrl = "https://tabitoken.com/v1/messages", apiKey = "secret")
        assertEquals("secret", anthropic.resolvedHeaders()["x-api-key"])
        assertEquals("2023-06-01", anthropic.resolvedHeaders()["anthropic-version"])
        assertNull("a Bearer token here is a 401", anthropic.resolvedHeaders()["Authorization"])

        val gemini = CustomEndpoint(baseUrl = "https://generativelanguage.googleapis.com/v1beta", apiKey = "g")
        assertEquals("g", gemini.resolvedHeaders()["x-goog-api-key"])

        val openai = CustomEndpoint(baseUrl = "https://api.kie.ai/v1", apiKey = "k")
        assertEquals("Bearer k", openai.resolvedHeaders()["Authorization"])
    }

    @Test fun `a user's own auth header is left alone`() {
        val endpoint = CustomEndpoint(
            baseUrl = "https://api.kie.ai/v1",
            apiKey = "k",
            headers = mapOf("Authorization" to "Basic abc"),
        )
        assertEquals("Basic abc", endpoint.resolvedHeaders()["Authorization"])
    }

    @Test fun `the chat URL is built per dialect, and a pasted suffix is not doubled`() {
        assertEquals(
            "https://tabitoken.com/v1/messages",
            CustomEndpoint(baseUrl = "https://tabitoken.com/v1/messages").chatUrl("claude-opus-5", true),
        )
        assertEquals(
            "https://g.example/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse",
            CustomEndpoint(baseUrl = "https://g.example/v1beta").chatUrl("gemini-3-pro", true),
        )
        assertEquals(
            "https://api.kie.ai/v1/chat/completions",
            CustomEndpoint(baseUrl = "https://api.kie.ai/v1/chat/completions").chatUrl("gpt-5-2", true),
        )
    }

    @Test fun `an explicit path overrides only the OpenAI shape`() {
        assertEquals(
            "https://x.example/v1/custom/chat",
            CustomEndpoint(baseUrl = "https://x.example/v1", endpointPath = "/custom/chat").chatUrl("m", true),
        )
        // The other two derive the path from the model; an override there would
        // send the request somewhere that cannot answer.
        assertEquals(
            "https://tabitoken.com/v1/messages",
            CustomEndpoint(baseUrl = "https://tabitoken.com/v1", endpointPath = "/custom/chat", dialect = Dialects.ANTHROPIC)
                .chatUrl("m", true),
        )
    }

    @Test fun `modelName fills in when the caller names none`() {
        val endpoint = CustomEndpoint(baseUrl = "https://g.example/v1beta", modelName = "gemini-3-pro")
        assertTrue(endpoint.chatUrl("", false).contains("gemini-3-pro"))
    }

    // ── The catalogue ──────────────────────────────────────────────────────

    @Test fun `owned_by is read, which a camelCase property silently misses`() {
        val models = ModelCatalog.parse(Dialects.OPENAI, """{"data":[{"id":"gpt-5-2","owned_by":"openai"}]}""")
        assertEquals("gpt-5-2", models.single().id)
        assertEquals("openai", models.single().ownedBy)
    }

    @Test fun `every envelope a gateway actually answers with is read`() {
        assertEquals(
            listOf("gpt-5-2"),
            ModelCatalog.parse(Dialects.OPENAI, """{"data":[{"id":"gpt-5-2"}]}""").map { it.id },
        )
        // kie.ai: the list is nested, and keyed on `model`.
        assertEquals(
            listOf("gpt-5-2", "gemini-3-pro"),
            ModelCatalog.parse(
                Dialects.OPENAI,
                """{"code":200,"msg":"success","data":{"total":2,"models":[{"model":"gpt-5-2"},{"model":"gemini-3-pro"}]}}""",
            ).map { it.id },
        )
        // Gemini prefixes its names, and the bare id is what goes in a path.
        assertEquals(
            listOf("gemini-3-pro"),
            ModelCatalog.parse(Dialects.GEMINI, """{"models":[{"name":"models/gemini-3-pro"}]}""").map { it.id },
        )
        // A bare array, and an array of plain strings.
        assertEquals(listOf("llama3"), ModelCatalog.parse(Dialects.OPENAI, """[{"id":"llama3"}]""").map { it.id })
        assertEquals(listOf("a", "b"), ModelCatalog.parse(Dialects.OPENAI, """["a","b"]""").map { it.id })
    }

    @Test fun `nothing usable yields nothing, rather than throwing`() {
        assertTrue(ModelCatalog.parse(Dialects.OPENAI, """{"status":404,"error":"Not Found"}""").isEmpty())
        assertTrue(ModelCatalog.parse(Dialects.OPENAI, "not json at all").isEmpty())
        assertTrue(ModelCatalog.parse(Dialects.OPENAI, null).isEmpty())
    }

    @Test fun `the catalogue is looked for outside the chat prefix too`() {
        // kie.ai serves chat at /v1 and its catalogue at /api/v1/models — a path
        // that appending to the base can never reach.
        val paths = ModelCatalog.candidatePaths(Dialects.OPENAI, "https://api.kie.ai/v1")
        assertTrue(paths.contains("https://api.kie.ai/v1/models"))
        assertTrue(paths.contains("https://api.kie.ai/api/v1/models"))
    }
}
