/**
 * Model ids NVIDIA advertises but will not serve.
 *
 * `GET /v1/models` is not a list of models you can call. Probed on 2026-09-11
 * with a live key, 43 of the 80 ids it returns answer
 * `404 {"detail":"Function '<uuid>': Not found for account '<id>'"}` on the very
 * first token — they are catalogue entries for NIMs this account has no
 * entitlement to, indistinguishable from working ones until you call them.
 *
 * That is what put `meta/llama2-70b` and `ai21labs/jamba-1.5-large-instruct` in
 * the model switcher and made the app look broken: pick one, get a 404, and
 * nothing suggests the model itself was the problem.
 *
 * This list is a floor, not a ceiling — entitlements differ per account and
 * change over time — so `nim.ts` also learns at runtime from the same 404
 * signature and drops an id for the rest of the session.
 */
export const UNSERVED_IDS: ReadonlySet<string> = new Set([
  '01-ai/yi-large',
  'adept/fuyu-8b',
  'ai21labs/jamba-1.5-large-instruct',
  'aisingapore/sea-lion-7b-instruct',
  'bigcode/starcoder2-15b',
  'databricks/dbrx-instruct',
  'deepseek-ai/deepseek-coder-6.7b-instruct',
  'google/codegemma-1.1-7b',
  'google/codegemma-7b',
  'google/gemma-2b',
  'google/gemma-3-12b-it',
  'google/gemma-3-4b-it',
  'google/recurrentgemma-2b',
  'ibm/granite-3.0-3b-a800m-instruct',
  'ibm/granite-3.0-8b-instruct',
  'ibm/granite-34b-code-instruct',
  'ibm/granite-8b-code-instruct',
  'meta/codellama-70b',
  'meta/llama2-70b',
  'microsoft/phi-3-vision-128k-instruct',
  'microsoft/phi-3.5-moe-instruct',
  'mistralai/codestral-22b-instruct-v0.1',
  'mistralai/mistral-7b-instruct-v0.3',
  'mistralai/mistral-large',
  'mistralai/mistral-large-2-instruct',
  'mistralai/mixtral-8x22b-v0.1',
  'moonshotai/kimi-k2.6',
  'nv-mistralai/mistral-nemo-12b-instruct',
  'nvidia/cosmos-reason2-8b',
  'nvidia/llama-3.1-nemotron-51b-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nvidia/llama3-chatqa-1.5-70b',
  'nvidia/mistral-nemo-minitron-8b-8k-instruct',
  'nvidia/nemotron-4-340b-instruct',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/neva-22b',
  'nvidia/vila',
  'writer/palmyra-creative-122b',
  'writer/palmyra-fin-70b-32k',
  'writer/palmyra-med-70b',
  'writer/palmyra-med-70b-32k',
  'zyphra/zamba2-7b-instruct',
]);

/**
 * Ids that are real and served, but are not chat models — embedding, safety
 * classification, OCR, translation, reward scoring. Listing them in a chat
 * switcher is its own kind of broken: they answer, then fail strangely.
 */
export const NON_CHAT = /embed|rerank|nemoguard|llama-guard|content-safety|safety-guard|topic-control|nemotron-parse|nvclip|deplot|kosmos|video-detector|riva-translate|340b-reward|arctic-embed|nemoretriever|ising-calibration/i;

/** Learned during this process from a live 404, on top of the list above. */
const learned = new Set<string>();

/** NVIDIA's distinctive "entitlement missing" body. */
export function isUnservedError(status: number, body: string): boolean {
  return status === 404 && /Function\s+'[0-9a-f-]{8,}'\s*:\s*Not found for account/i.test(body);
}

export function rememberUnserved(id: string): void {
  learned.add(id);
}

export function isUnserved(id: string): boolean {
  return UNSERVED_IDS.has(id) || learned.has(id);
}

/** Every id this process knows will not answer. */
export function unservedIds(): string[] {
  return [...UNSERVED_IDS, ...learned];
}
