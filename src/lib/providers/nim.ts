import { inferCapabilities, labelFor, NIM_MODELS, resolveModelId, vendorFor } from './registry';
import type { UpstreamConfig } from './openai-compat';
import { completeChat } from './openai-compat';
import { ProviderError, type ChatRequest, type ModelDescriptor } from './types';

/**
 * NVIDIA NIM adapter.
 *
 * NIM speaks OpenAI-compatible chat completions at
 * `https://integrate.api.nvidia.com/v1`, and hosts image / retrieval NIMs on
 * `https://ai.api.nvidia.com/v1/...`. The key is server-side only — the browser
 * never sees it, and NIM sends no CORS headers, so this must be proxied.
 */

export const NIM_BASE = process.env.NVIDIA_NIM_BASE_URL?.replace(/\/+$/, '') ?? 'https://integrate.api.nvidia.com/v1';
export const NIM_GENAI_BASE = process.env.NVIDIA_NIM_GENAI_BASE_URL?.replace(/\/+$/, '') ?? 'https://ai.api.nvidia.com/v1/genai';
export const NIM_RETRIEVAL_BASE = process.env.NVIDIA_NIM_RETRIEVAL_BASE_URL?.replace(/\/+$/, '') ?? 'https://integrate.api.nvidia.com/v1';

export function nimKey(): string {
  const key = process.env.NVIDIA_NIM_API_KEY?.trim();
  if (!key) {
    throw new ProviderError(
      'NVIDIA_NIM_API_KEY is not configured. Add it to .env.local (get one free at build.nvidia.com), or switch the active model to Pollinations, which needs no key.',
      { status: 503, code: 'nim_key_missing' },
    );
  }
  return key;
}

export function hasNimKey(): boolean {
  return Boolean(process.env.NVIDIA_NIM_API_KEY?.trim());
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${nimKey()}` };
}

/** Turn NIM's terse HTTP failures into something the user can act on. */
export function describeNimError(
  status: number,
  body: string,
): { message: string; code?: string; retryable?: boolean } | null {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { detail?: string | Array<{ msg?: string }>; error?: { message?: string }; message?: string };
    detail =
      (typeof parsed.detail === 'string' ? parsed.detail : parsed.detail?.[0]?.msg) ??
      parsed.error?.message ??
      parsed.message ??
      detail;
  } catch {
    /* keep the raw text */
  }

  switch (status) {
    case 401:
    case 403:
      return {
        message: `NVIDIA NIM rejected the API key (${status}). Regenerate it at build.nvidia.com and update NVIDIA_NIM_API_KEY. ${detail}`.trim(),
        code: 'nim_unauthorized',
        retryable: false,
      };
    case 404:
      return {
        message: `NVIDIA NIM has no model at that id (404). Model ids rotate — hit refresh in the model switcher to re-probe the live catalogue. ${detail}`.trim(),
        code: 'nim_model_not_found',
        retryable: false,
      };
    case 410:
      return {
        message: `This NIM has been retired by NVIDIA and no longer serves requests. ${detail} Pick another model — hit refresh in the switcher to re-probe the live catalogue.`,
        code: 'nim_end_of_life',
        retryable: false,
      };
    case 429:
      return {
        message: 'NVIDIA NIM is rate limiting this key. Back off, or switch to Pollinations while the window resets.',
        code: 'nim_rate_limited',
        retryable: true,
      };
    case 400:
      return {
        message: `NVIDIA NIM rejected the request payload (400): ${detail}`,
        code: 'nim_bad_request',
        retryable: false,
      };
    default:
      return status >= 500
        ? { message: `NVIDIA NIM upstream error ${status}: ${detail}`, code: 'nim_upstream', retryable: true }
        : null;
  }
}

export function nimChatConfig(): UpstreamConfig {
  return {
    url: `${NIM_BASE}/chat/completions`,
    headers: authHeaders(),
    supportsStreaming: true,
    timeoutMs: 300_000,
    describeError: describeNimError,
    shapeBody: (body) => {
      // NIM streams token usage only when explicitly asked.
      if (body.stream) body.stream_options = { include_usage: true };
      return body;
    },
  };
}

/** Live catalogue probe. Cached briefly — the list is large and rarely changes. */
let catalogueCache: { at: number; ids: string[] } | null = null;
const CATALOGUE_TTL_MS = 10 * 60_000;

export async function listCatalogueIds(force = false): Promise<string[]> {
  if (!force && catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.ids;
  }
  if (!hasNimKey()) return [];

  try {
    const res = await fetch(`${NIM_BASE}/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return catalogueCache?.ids ?? [];
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    catalogueCache = { at: Date.now(), ids };
    return ids;
  } catch {
    return catalogueCache?.ids ?? [];
  }
}

/**
 * Merge the live catalogue with bundled metadata.
 * Live ids win; static entries survive only when the probe is unavailable, and
 * aliases are always kept so the UI can explain the substitution.
 */
export async function listModels(): Promise<ModelDescriptor[]> {
  const liveIds = await listCatalogueIds();
  const staticById = new Map(NIM_MODELS.map((m) => [m.id, m]));
  const out: ModelDescriptor[] = [];

  for (const id of liveIds) {
    const known = staticById.get(id);
    out.push(
      known
        ? { ...known, origin: 'catalogue' }
        : {
            id,
            provider: 'nim',
            label: labelFor(id),
            vendor: vendorFor(id),
            capabilities: inferCapabilities(id),
            emitsReasoning: inferCapabilities(id).includes('reasoning'),
            origin: 'catalogue',
          },
    );
    staticById.delete(id);
  }

  // Entries the chat catalogue can never confirm still belong in the list:
  //   - image/video/audio NIMs live on ai.api.nvidia.com, not /v1/models
  //   - partner-only models exist but are not served by this base URL
  //   - aliases are resolved against whatever the catalogue does contain
  // Everything else static is dropped once a live catalogue is available, so a
  // stale bundled id never appears as if it were reachable.
  const OFF_CATALOGUE: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'model3d']);

  for (const leftover of staticById.values()) {
    if (leftover.origin === 'alias') {
      out.push({ ...leftover, resolvesTo: resolveModelId('nim', leftover.id, liveIds) });
    } else if (
      !liveIds.length ||
      leftover.origin === 'partner-only' ||
      leftover.capabilities.some((c) => OFF_CATALOGUE.has(c))
    ) {
      out.push(leftover);
    }
  }

  return out;
}

export async function resolveNimModel(id: string): Promise<string> {
  return resolveModelId('nim', id, await listCatalogueIds());
}

// ── Retrieval NIMs (embeddings + reranking) ─────────────────────────────────

/**
 * Embedding models, in preference order.
 *
 * NIM entitlements are per-account: an id can be in `/v1/models` and still return
 * `404 Function ... not found for account`. Verified against a live key —
 * `nemotron-3-embed-1b` answered (2048 dims) while the older embedqa and arctic
 * NIMs did not — so the client tries candidates in order and remembers the winner
 * rather than hard-failing on the first 404.
 */
export const EMBED_CANDIDATES = [
  'nvidia/nemotron-3-embed-1b',
  'nvidia/llama-3.2-nv-embedqa-1b-v1',
  'nvidia/nv-embedqa-mistral-7b-v2',
  'nvidia/embed-qa-4',
  'snowflake/arctic-embed-l',
] as const;

export const EMBED_MODEL = EMBED_CANDIDATES[0];

/** Cached once a candidate answers; `null` once every candidate has 404'd. */
let workingEmbedModel: string | null | undefined;

async function embedOnce(
  texts: string[],
  inputType: 'query' | 'passage',
  model: string,
): Promise<number[][] | { entitlementMissing: true } > {
  const res = await fetch(`${NIM_RETRIEVAL_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ input: texts, model, input_type: inputType, encoding_format: 'float', truncate: 'END' }),
    signal: AbortSignal.timeout(90_000),
  });

  if (res.status === 404) return { entitlementMissing: true };

  if (!res.ok) {
    throw new ProviderError(`NIM embedding failed (${model}): ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400), {
      status: res.status,
      code: 'nim_embed_failed',
      retryable: res.status >= 500 || res.status === 429,
    });
  }

  const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
  return (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(
  texts: string[],
  inputType: 'query' | 'passage' = 'passage',
  model?: string,
): Promise<number[][]> {
  if (model) {
    const result = await embedOnce(texts, inputType, model);
    if (Array.isArray(result)) return result;
    throw new ProviderError(`This account has no entitlement for the embedding NIM "${model}".`, {
      status: 404,
      code: 'nim_embed_unentitled',
    });
  }

  if (workingEmbedModel) {
    const result = await embedOnce(texts, inputType, workingEmbedModel);
    if (Array.isArray(result)) return result;
    workingEmbedModel = undefined; // entitlement changed; re-discover
  }

  if (workingEmbedModel === null) {
    throw new ProviderError(
      'No embedding NIM is entitled for this account, so retrieval cannot rank semantically. Workdrive falls back to lexical scoring.',
      { status: 404, code: 'nim_embed_unentitled' },
    );
  }

  for (const candidate of EMBED_CANDIDATES) {
    const result = await embedOnce(texts, inputType, candidate);
    if (Array.isArray(result)) {
      workingEmbedModel = candidate;
      return result;
    }
  }

  workingEmbedModel = null;
  throw new ProviderError(
    `None of the embedding NIMs (${EMBED_CANDIDATES.join(', ')}) are entitled for this account. Retrieval falls back to lexical ranking.`,
    { status: 404, code: 'nim_embed_unentitled' },
  );
}

/** Which embedding NIM actually answered, for display in the retrieval notes. */
export function activeEmbedModel(): string | null | undefined {
  return workingEmbedModel;
}

/**
 * Hosted reranking is gone.
 *
 * NVIDIA's reranker NIMs on `ai.api.nvidia.com/v1/retrieval/.../reranking` now
 * answer `410 Gone — this endpoint has reached its end of life`, and no rerank
 * model is present in `/v1/models`. Rather than shipping a call that always
 * fails, the retrieval pipeline ranks by embedding cosine similarity alone.
 *
 * Set `NVIDIA_NIM_RERANK_URL` to a self-hosted reranker NIM to re-enable a true
 * cross-encoder rerank pass.
 */
export const RERANK_URL = process.env.NVIDIA_NIM_RERANK_URL?.replace(/\/+$/, '');

export function rerankAvailable(): boolean {
  return Boolean(RERANK_URL);
}

export async function rerank(
  query: string,
  passages: string[],
  model = process.env.NVIDIA_NIM_RERANK_MODEL ?? 'nvidia/llama-3.2-nv-rerankqa-1b-v2',
): Promise<Array<{ index: number; score: number }>> {
  if (!RERANK_URL) {
    throw new ProviderError(
      'No reranker configured. NVIDIA retired its hosted reranking endpoints (HTTP 410); set NVIDIA_NIM_RERANK_URL to a self-hosted reranker NIM to enable this stage.',
      { status: 501, code: 'nim_rerank_unavailable' },
    );
  }

  const res = await fetch(RERANK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      model,
      query: { text: query },
      passages: passages.map((text) => ({ text })),
      truncate: 'END',
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new ProviderError(`Reranker failed: ${res.status}`, {
      status: res.status,
      code: 'nim_rerank_failed',
      retryable: res.status >= 500,
    });
  }

  const json = (await res.json()) as { rankings?: Array<{ index: number; logit: number }> };
  return (json.rankings ?? []).map((r) => ({ index: r.index, score: r.logit }));
}

// ── Image NIMs ──────────────────────────────────────────────────────────────

export interface NimImageResult {
  /** `data:image/...;base64,...` */
  dataUrl: string;
  model: string;
  seed?: number;
}

/**
 * NIM image models return base64 artifacts rather than URLs. Payload keys differ
 * slightly per family, so we normalise both the request and the response.
 */
export async function generateImage(opts: {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfgScale?: number;
}): Promise<NimImageResult> {
  const { model, prompt } = opts;
  const isFlux = model.includes('flux');

  const body: Record<string, unknown> = isFlux
    ? {
        prompt,
        // FLUX on ai.api.nvidia.com rejects `mode` and `cfg_scale` with a 500,
        // and constrains dimensions to 768–1280 in multiples of 64. Both verified
        // against the live endpoint.
        width: clampFluxDimension(opts.width ?? 1024),
        height: clampFluxDimension(opts.height ?? 1024),
        steps: Math.min(Math.max(opts.steps ?? 50, 1), 50),
        seed: opts.seed ?? 0,
      }
    : {
        prompt,
        negative_prompt: opts.negativePrompt ?? '',
        aspect_ratio: (opts.width ?? 1024) === (opts.height ?? 1024) ? '1:1' : '16:9',
        seed: opts.seed ?? 0,
        steps: opts.steps ?? 50,
        cfg_scale: opts.cfgScale ?? 4.5,
      };

  const res = await fetch(`${NIM_GENAI_BASE}/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    throw new ProviderError(
      `NIM image generation failed (${model}): ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400),
      { status: res.status, code: 'nim_image_failed', retryable: res.status >= 500 },
    );
  }

  const json = (await res.json()) as {
    image?: string;
    artifacts?: Array<{ base64?: string; seed?: number }>;
    data?: Array<{ b64_json?: string }>;
  };

  const artifact = json.artifacts?.[0];
  const b64 = json.image ?? artifact?.base64 ?? json.data?.[0]?.b64_json ?? null;

  if (!b64) {
    throw new ProviderError(`NIM image model ${model} returned no artifact.`, { code: 'nim_image_empty' });
  }

  return {
    dataUrl: b64.startsWith('data:') ? b64 : `data:${sniffImageMime(b64)};base64,${b64}`,
    model,
    seed: artifact?.seed,
  };
}

/** FLUX accepts 768–1280 in multiples of 64; anything else is a 422. */
function clampFluxDimension(value: number): number {
  const clamped = Math.min(Math.max(value, 768), 1280);
  return Math.round(clamped / 64) * 64;
}

/**
 * NIM image NIMs return JPEG despite the docs implying PNG, and a wrong mime on
 * a data URL breaks canvas reads and downstream downloads. Sniff the magic bytes
 * from the base64 prefix instead of assuming.
 */
function sniffImageMime(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

/** Convenience wrapper for internal single-shot calls (planning, classification). */
export async function nimComplete(req: Omit<ChatRequest, 'provider'>): Promise<{ content: string; reasoning: string }> {
  const model = await resolveNimModel(req.model);
  return completeChat(nimChatConfig(), { ...req, provider: 'nim', stream: false }, model);
}
