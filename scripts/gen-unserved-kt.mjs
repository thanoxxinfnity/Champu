import fs from 'node:fs';

const src = fs.readFileSync('src/lib/providers/unserved.ts', 'utf8');
const start = src.indexOf('UNSERVED_IDS');
const block = src.slice(start, src.indexOf(']);', start));
const ids = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
const nonChat = /NON_CHAT = \/([^/]+)\//.exec(src)[1];

const lines = [
  'package com.chomugiri.workspace.providers',
  '',
  '/**',
  ' * Model ids NVIDIA advertises but will not serve.',
  ' *',
  ' * `GET /v1/models` is not a list of models you can call: of the 80 ids it',
  ' * returns, 43 answer 404 with NVIDIA\'s "Not found for account" body on the',
  ' * very first token. They are catalogue entries for NIMs the account has no',
  ' * entitlement to, indistinguishable from working ones until you call one.',
  ' *',
  ' * The web build has filtered these since it learned about them. The APK builds',
  ' * its own catalogue natively and did not — which is how `meta/llama2-70b` and',
  ' * `bigcode/starcoder2-15b` still reached the switcher on the phone and then',
  ' * answered "NVIDIA NIM has no model at that id".',
  ' *',
  ' * Generated from src/lib/providers/unserved.ts; a test reads both and fails',
  ' * if they drift.',
  ' */',
  'object Unserved {',
  '',
  '    val IDS: Set<String> = setOf(',
  ...ids.map((id) => `        "${id}",`),
  '    )',
  '',
  '    /**',
  '     * Ids that are real and served, but are not chat models — embedding, safety',
  '     * classification, OCR, translation, reward scoring. Listing them in a chat',
  '     * switcher is its own kind of broken: they answer, then fail strangely.',
  '     */',
  `    val NON_CHAT = Regex("${nonChat}", RegexOption.IGNORE_CASE)`,
  '',
  '    /** Learned during this process from a live 404, on top of the list above. */',
  '    private val learned = mutableSetOf<String>()',
  '',
  '    /** NVIDIA\'s distinctive "entitlement missing" body. */',
  '    fun isUnservedError(status: Int, body: String): Boolean =',
  '        status == 404 &&',
  '            Regex("""Function\\s+\'[0-9a-f-]{8,}\'\\s*:\\s*Not found for account""", RegexOption.IGNORE_CASE)',
  '                .containsMatchIn(body)',
  '',
  '    fun remember(id: String) {',
  '        synchronized(learned) { learned.add(id) }',
  '    }',
  '',
  '    fun isUnserved(id: String): Boolean =',
  '        IDS.contains(id) || synchronized(learned) { learned.contains(id) }',
  '',
  '    /** Everything that has no business in a chat switcher. */',
  '    fun keepChatModels(ids: List<String>): List<String> =',
  '        ids.filter { !isUnserved(it) && !NON_CHAT.containsMatchIn(it) }',
  '}',
  '',
];

fs.writeFileSync('android/app/src/main/java/com/chomugiri/workspace/providers/Unserved.kt', lines.join('\n'));
console.log('written', ids.length, 'ids');
