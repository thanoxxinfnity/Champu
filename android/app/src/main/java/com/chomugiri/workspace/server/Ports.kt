package com.chomugiri.workspace.server

import android.content.Context
import android.content.res.AssetManager

/**
 * Seams between the server and the Android platform.
 *
 * The HTTP server and the API router are the highest-risk code in this app and
 * the hardest to exercise on a device. Depending on these two interfaces instead
 * of AssetManager and Context directly means both run unchanged under a plain
 * JVM test, with real network calls, before the APK is ever installed.
 */

interface AssetSource {
    /** Returns null when the asset does not exist. */
    fun open(path: String): java.io.InputStream?
}

interface SecretStore {
    fun get(key: String): String
    fun put(key: String, value: String)
}

class AndroidAssetSource(private val assets: AssetManager) : AssetSource {
    override fun open(path: String): java.io.InputStream? =
        runCatching { assets.open(path) }.getOrNull()
}

class PrefsSecretStore(context: Context) : SecretStore {
    private val prefs = context.getSharedPreferences("chomugiri-secrets", Context.MODE_PRIVATE)
    override fun get(key: String): String = prefs.getString(key, "").orEmpty().trim()
    override fun put(key: String, value: String) {
        prefs.edit().putString(key, value.trim()).apply()
    }
}
