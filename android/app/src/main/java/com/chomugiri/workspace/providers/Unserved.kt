package com.chomugiri.workspace.providers

/**
 * Model ids NVIDIA advertises but will not serve.
 *
 * `GET /v1/models` is not a list of models you can call: of the 80 ids it
 * returns, 43 answer 404 with NVIDIA's "Not found for account" body on the
 * very first token. They are catalogue entries for NIMs the account has no
 * entitlement to, indistinguishable from working ones until you call one.
 *
 * The web build has filtered these since it learned about them. The APK builds
 * its own catalogue natively and did not — which is how `meta/llama2-70b` and
 * `bigcode/starcoder2-15b` still reached the switcher on the phone and then
 * answered "NVIDIA NIM has no model at that id".
 *
 * Generated from src/lib/providers/unserved.ts; a test reads both and fails
 * if they drift.
 */
object Unserved {

    val IDS: Set<String> = setOf(
        "01-ai/yi-large",
        "adept/fuyu-8b",
        "ai21labs/jamba-1.5-large-instruct",
        "aisingapore/sea-lion-7b-instruct",
        "bigcode/starcoder2-15b",
        "databricks/dbrx-instruct",
        "deepseek-ai/deepseek-coder-6.7b-instruct",
        "google/codegemma-1.1-7b",
        "google/codegemma-7b",
        "google/gemma-2b",
        "google/gemma-3-12b-it",
        "google/gemma-3-4b-it",
        "google/recurrentgemma-2b",
        "ibm/granite-3.0-3b-a800m-instruct",
        "ibm/granite-3.0-8b-instruct",
        "ibm/granite-34b-code-instruct",
        "ibm/granite-8b-code-instruct",
        "meta/codellama-70b",
        "meta/llama2-70b",
        "microsoft/phi-3-vision-128k-instruct",
        "microsoft/phi-3.5-moe-instruct",
        "mistralai/codestral-22b-instruct-v0.1",
        "mistralai/mistral-7b-instruct-v0.3",
        "mistralai/mistral-large",
        "mistralai/mistral-large-2-instruct",
        "mistralai/mixtral-8x22b-v0.1",
        "moonshotai/kimi-k2.6",
        "nv-mistralai/mistral-nemo-12b-instruct",
        "nvidia/cosmos-reason2-8b",
        "nvidia/llama-3.1-nemotron-51b-instruct",
        "nvidia/llama-3.1-nemotron-70b-instruct",
        "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        "nvidia/llama3-chatqa-1.5-70b",
        "nvidia/mistral-nemo-minitron-8b-8k-instruct",
        "nvidia/nemotron-4-340b-instruct",
        "nvidia/nemotron-nano-3-30b-a3b",
        "nvidia/neva-22b",
        "nvidia/vila",
        "writer/palmyra-creative-122b",
        "writer/palmyra-fin-70b-32k",
        "writer/palmyra-med-70b",
        "writer/palmyra-med-70b-32k",
        "zyphra/zamba2-7b-instruct",
    )

    /**
     * Ids that are real and served, but are not chat models — embedding, safety
     * classification, OCR, translation, reward scoring. Listing them in a chat
     * switcher is its own kind of broken: they answer, then fail strangely.
     */
    val NON_CHAT = Regex("embed|rerank|nemoguard|llama-guard|content-safety|safety-guard|topic-control|nemotron-parse|nvclip|deplot|kosmos|video-detector|riva-translate|340b-reward|arctic-embed|nemoretriever|ising-calibration", RegexOption.IGNORE_CASE)

    /** Learned during this process from a live 404, on top of the list above. */
    private val learned = mutableSetOf<String>()

    /** NVIDIA's distinctive "entitlement missing" body. */
    fun isUnservedError(status: Int, body: String): Boolean =
        status == 404 &&
            Regex("""Function\s+'[0-9a-f-]{8,}'\s*:\s*Not found for account""", RegexOption.IGNORE_CASE)
                .containsMatchIn(body)

    fun remember(id: String) {
        synchronized(learned) { learned.add(id) }
    }

    fun isUnserved(id: String): Boolean =
        IDS.contains(id) || synchronized(learned) { learned.contains(id) }

    /** Everything that has no business in a chat switcher. */
    fun keepChatModels(ids: List<String>): List<String> =
        ids.filter { !isUnserved(it) && !NON_CHAT.containsMatchIn(it) }
}
