package com.chomugiri.workspace

import com.chomugiri.workspace.providers.EndpointProbe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The APK answers /api/endpoints/probe itself, so these are the rules the phone
 * actually runs — not the TypeScript ones. They are asserted against the real
 * shapes that broke in the field.
 */
class EndpointProbeTest {

    @Test
    fun `strips a pasted endpoint back to its base`() {
        assertEquals("https://api.kie.ai/v1", EndpointProbe.normalizeBase("https://api.kie.ai/v1/chat/completions"))
        assertEquals("https://api.kie.ai/v1", EndpointProbe.normalizeBase("https://api.kie.ai/v1/models"))
        assertEquals("https://api.kie.ai/v1", EndpointProbe.normalizeBase("https://api.kie.ai/v1/ "))
        assertEquals("https://api.kie.ai/v1", EndpointProbe.normalizeBase("https://api.kie.ai/v1"))
    }

    @Test
    fun `looks for the model list under the api sibling path`() {
        val urls = EndpointProbe.modelListCandidates("https://api.kie.ai/v1").map { it.url }
        // The literal case kept the APK reporting "answered nothing": kie.ai
        // 404s /v1/models and serves the list from /api/v1/models.
        assertTrue(urls.contains("https://api.kie.ai/v1/models"))
        assertTrue(urls.contains("https://api.kie.ai/api/v1/models"))
    }

    @Test
    fun `looks for chat outside the model-list prefix`() {
        assertEquals(
            listOf("https://api.kie.ai/v1", "https://api.kie.ai/api/v1"),
            EndpointProbe.chatBaseCandidates("https://api.kie.ai/v1/models"),
        )
        assertEquals(
            listOf("https://api.kie.ai/api/v1", "https://api.kie.ai/v1"),
            EndpointProbe.chatBaseCandidates("https://api.kie.ai/api/v1"),
        )
    }

    @Test
    fun `reads ids out of every envelope a gateway uses`() {
        assertEquals(listOf("a", "b"), EndpointProbe.modelIdsFrom("""{"data":[{"id":"a"},{"id":"b"}]}"""))
        assertEquals(listOf("a"), EndpointProbe.modelIdsFrom("""{"models":["a"]}"""))
        assertEquals(listOf("a"), EndpointProbe.modelIdsFrom("""["a"]"""))
        // kie.ai: a { code, msg, data: { models } } envelope keyed on `model`.
        assertEquals(
            listOf("gpt-5-2", "gemini-3-pro"),
            EndpointProbe.modelIdsFrom("""{"code":200,"msg":"success","data":{"total":2,"models":[{"model":"gpt-5-2"},{"model":"gemini-3-pro"}]}}"""),
        )
        assertEquals(emptyList<String>(), EndpointProbe.modelIdsFrom("""{"status":404}"""))
    }

    @Test
    fun `keeps chat models and drops the media catalogue`() {
        val ids = listOf("gpt-5-2", "gemini-3-pro", "kling/v2-1-master-text-to-video", "flux-kontext", "elevenlabs/tts")
        assertEquals(listOf("gpt-5-2", "gemini-3-pro"), EndpointProbe.chatModelsOnly(ids))
        // A list with nothing chat-shaped is shown whole: the heuristic is
        // wrong for that endpoint, and something beats nothing.
        val media = listOf("kling/v2-1-master-text-to-video")
        assertEquals(media, EndpointProbe.chatModelsOnly(media))
    }

    @Test
    fun `catches an error carried inside a 200`() {
        val info = EndpointProbe.envelopeError("""{"code":422,"msg":"The model is not supported","data":null}""")
        assertEquals("model_unsupported", info?.code)
        assertTrue(info!!.message.startsWith("The model is not supported"))
        assertTrue(info.message.contains("does not serve that model id"))
    }

    @Test
    fun `leaves a real completion alone`() {
        assertNull(EndpointProbe.envelopeError("""{"choices":[{"message":{"content":"the error code was 422"}}]}"""))
        assertNull(EndpointProbe.envelopeError("""{"code":200,"data":{}}"""))
        assertNull(EndpointProbe.envelopeError("not json"))
    }
}
