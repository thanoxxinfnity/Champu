package com.chomugiri.workspace

import com.chomugiri.workspace.providers.DuckAi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the APK's Duck.ai catalogue to the same wire ids and hand-off shape the
 * web build uses, so the two cannot drift apart.
 */
class DuckAiTest {

    @Test
    fun `catalogue carries the exact ids duck ai expects`() {
        val models = DuckAi.listModels()
        val ids = (0 until models.length()).map { models.getJSONObject(it).getString("id") }.sorted()
        assertEquals(
            listOf(
                "claude-haiku-4-5",
                "gpt-5.4-mini",
                "gpt-5.6-luna",
                "mistral-small-2603",
                "tinfoil/gemma4-31b",
                "tinfoil/gpt-oss-120b",
            ),
            ids,
        )
    }

    @Test
    fun `every model is hand-off only and says it is free`() {
        val models = DuckAi.listModels()
        for (i in 0 until models.length()) {
            val m = models.getJSONObject(i)
            assertEquals("browser-only", m.getString("origin"))
            assertEquals("duckai", m.getString("provider"))
            assertTrue(m.getString("note").contains("Free", ignoreCase = true))
        }
    }

    @Test
    fun `hand-off url carries prompt, model, and the flags duck ai needs`() {
        val url = DuckAi.handoffUrl("tinfoil/gemma4-31b", "  build me an APK  ")
        assertTrue(url.startsWith("https://duck.ai/?"))
        assertTrue(url.contains("q=build+me+an+APK"))
        // prompt=1 auto-sends; home=1 stops duck.ai dropping a short prompt.
        assertTrue(url.contains("prompt=1"))
        assertTrue(url.contains("home=1"))
        assertTrue(url.contains("model=tinfoil%2Fgemma4-31b"))
    }

    @Test
    fun `a prompt containing separators cannot inject another model`() {
        val url = DuckAi.handoffUrl("gpt-5.6-luna", "a&model=evil")
        assertTrue(url.contains("q=a%26model%3Devil"))
        assertTrue(url.contains("model=gpt-5.6-luna"))
    }

    @Test
    fun `an empty model still yields a usable url`() {
        val url = DuckAi.handoffUrl("", "hello")
        assertTrue(url.contains("q=hello"))
        assertTrue(!url.contains("model="))
    }
}
