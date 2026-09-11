package com.chomugiri.workspace.server

/**
 * Capability inference for bare ids returned by a live catalogue probe.
 * Mirrors `registry.ts#inferCapabilities` so the Android build classifies models
 * exactly the way the web build does.
 */
object ModelMeta {

    private val CHAT = listOf("chat", "tools")
    private val REASON = listOf("chat", "tools", "reasoning")

    fun capabilities(id: String): List<String> {
        val l = id.lowercase()
        return when {
            Regex("embed|nvclip").containsMatchIn(l) -> listOf("embedding")
            Regex("rerank|reward|ranking").containsMatchIn(l) -> listOf("rerank")
            Regex("flux|stable-diffusion|sdxl|diffusiongemma|qwen-image").containsMatchIn(l) -> listOf("image")
            Regex("(^|[-_/])(video|sora|veo|kling|wan|cogvideo|ltx)").containsMatchIn(l) -> listOf("video")
            Regex("(^|[-_/])(3d|trellis|shap-?e|triposr|hunyuan3d|mesh)").containsMatchIn(l) -> listOf("model3d")
            Regex("(^|[-_/])(tts|whisper|speech|voice|parakeet|chatterbox)").containsMatchIn(l) -> listOf("audio")
            Regex("omni").containsMatchIn(l) -> listOf("chat", "tools", "reasoning", "vision", "audio")
            Regex("vision|-vl|vlm|kosmos|neva|vila|fuyu|deplot|cosmos|parse").containsMatchIn(l) -> listOf("chat", "vision")
            Regex("kimi|nemotron-3|muse|deepseek-v4|gpt-oss|reason|thinking|glm-[5-9]|lightning").containsMatchIn(l) -> REASON
            else -> CHAT
        }
    }

    fun label(id: String): String =
        (if (id.contains('/')) id.substringAfter('/') else id)
            .replace(Regex("[-_]"), " ")
            .split(' ')
            .joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }

    private val VENDORS = mapOf(
        "moonshotai" to "Moonshot AI", "z-ai" to "Zhipu AI", "zai-org" to "Zhipu AI", "thudm" to "Zhipu AI",
        "deepseek-ai" to "DeepSeek", "meta" to "Meta", "nvidia" to "NVIDIA", "nv-mistralai" to "NVIDIA",
        "qwen" to "Alibaba", "mistralai" to "Mistral", "google" to "Google", "microsoft" to "Microsoft",
        "openai" to "OpenAI", "ibm" to "IBM", "writer" to "Writer", "snowflake" to "Snowflake",
        "black-forest-labs" to "Black Forest Labs", "stabilityai" to "Stability AI",
        "databricks" to "Databricks", "bigcode" to "BigCode", "01-ai" to "01.AI",
        "ai21labs" to "AI21 Labs", "poolside" to "Poolside", "zyphra" to "Zyphra",
        "adept" to "Adept", "aisingapore" to "AI Singapore", "resemble-ai" to "Resemble.AI",
    )

    fun vendor(id: String): String {
        val head = if (id.contains('/')) id.substringBefore('/') else "unknown"
        return VENDORS[head] ?: head
    }
}
