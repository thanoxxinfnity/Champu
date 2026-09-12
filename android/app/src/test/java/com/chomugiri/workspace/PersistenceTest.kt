package com.chomugiri.workspace

import com.chomugiri.workspace.server.ApiRouter
import com.chomugiri.workspace.server.SecretStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app used to forget everything when it was killed.
 *
 * Not because anything deleted it: the workspace is served from
 * http://127.0.0.1:<port>, browser storage is scoped to the origin, and the
 * origin includes the port. Binding port 0 gave a new port every launch, so
 * every launch was a different origin with its own empty IndexedDB — endpoints,
 * tokens, history and theme all "gone".
 *
 * These lock in the two halves of the fix: the port is remembered, and no
 * credential depends on browser storage at all.
 */
class PersistenceTest {

    /** Stands in for SharedPreferences — survives an ApiRouter, like the real one. */
    private class FakeStore(private val map: MutableMap<String, String> = mutableMapOf()) : SecretStore {
        override fun get(key: String): String = map[key] ?: ""
        override fun put(key: String, value: String) { map[key] = value }
    }

    @Test
    fun `the served port is remembered across router instances`() {
        val store = FakeStore()
        ApiRouter(store).servedPort = 47615

        // A new launch builds a new router over the same preferences.
        assertEquals(47615, ApiRouter(store).servedPort)
    }

    @Test
    fun `an unset port reads as zero rather than throwing`() {
        assertEquals(0, ApiRouter(FakeStore()).servedPort)
    }

    @Test
    fun `a corrupt stored port degrades to zero instead of crashing the launch`() {
        val store = FakeStore(mutableMapOf("served_port" to "not-a-number"))
        assertEquals(0, ApiRouter(store).servedPort)
    }

    @Test
    fun `every credential survives a restart, not just the NIM key`() {
        val store = FakeStore()
        ApiRouter(store).apply {
            nimKey = "nvapi-abc"
            pollinationsToken = "poll-xyz"
            vercelToken = "vercel-123"
            vercelTeamId = "team_9"
        }

        val afterRestart = ApiRouter(store)
        assertEquals("nvapi-abc", afterRestart.nimKey)
        assertEquals("poll-xyz", afterRestart.pollinationsToken)
        assertEquals("vercel-123", afterRestart.vercelToken)
        assertEquals("team_9", afterRestart.vercelTeamId)
    }

    @Test
    fun `clearing one credential leaves the others alone`() {
        val store = FakeStore()
        val router = ApiRouter(store)
        router.nimKey = "nvapi-abc"
        router.vercelToken = "vercel-123"

        router.nimKey = ""

        assertTrue(router.nimKey.isEmpty())
        assertEquals("vercel-123", router.vercelToken)
    }
}
