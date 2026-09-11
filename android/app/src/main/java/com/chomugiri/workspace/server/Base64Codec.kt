package com.chomugiri.workspace.server

/**
 * Base64 that works on API 24.
 *
 * `java.util.Base64` is API 26+ and `android.util.Base64` returns stubbed values
 * under JVM unit tests, so neither covers both the minSdk floor and the test
 * suite. This does, in about thirty lines, with no dependency and no desugaring
 * build flag.
 */
object Base64Codec {

    private const val STANDARD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    private const val URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(data: ByteArray): String {
        val out = StringBuilder((data.size + 2) / 3 * 4)
        var i = 0
        while (i + 2 < data.size) {
            val n = (data[i].toInt() and 0xff shl 16) or (data[i + 1].toInt() and 0xff shl 8) or (data[i + 2].toInt() and 0xff)
            out.append(STANDARD[n ushr 18 and 0x3f]).append(STANDARD[n ushr 12 and 0x3f])
                .append(STANDARD[n ushr 6 and 0x3f]).append(STANDARD[n and 0x3f])
            i += 3
        }
        when (data.size - i) {
            1 -> {
                val n = data[i].toInt() and 0xff shl 16
                out.append(STANDARD[n ushr 18 and 0x3f]).append(STANDARD[n ushr 12 and 0x3f]).append("==")
            }
            2 -> {
                val n = (data[i].toInt() and 0xff shl 16) or (data[i + 1].toInt() and 0xff shl 8)
                out.append(STANDARD[n ushr 18 and 0x3f]).append(STANDARD[n ushr 12 and 0x3f])
                    .append(STANDARD[n ushr 6 and 0x3f]).append('=')
            }
        }
        return out.toString()
    }

    /** Accepts both alphabets and tolerates missing padding, which Bing omits. */
    fun decode(input: String): ByteArray {
        val lookup = IntArray(128) { -1 }
        STANDARD.forEachIndexed { i, c -> lookup[c.code] = i }
        URL_SAFE.forEachIndexed { i, c -> lookup[c.code] = i }

        val clean = input.filter { it.code < 128 && lookup[it.code] >= 0 }
        val out = java.io.ByteArrayOutputStream(clean.length * 3 / 4 + 3)

        var buffer = 0
        var bits = 0
        for (c in clean) {
            buffer = (buffer shl 6) or lookup[c.code]
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buffer ushr bits) and 0xff)
            }
        }
        return out.toByteArray()
    }
}
