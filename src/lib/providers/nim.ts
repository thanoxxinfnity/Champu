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

  for (const leftover of staticById.values()) {
    if (leftover.origin === 'alias') {
      out.push({ ...leftover, resolvesTo: resolveModelId('nim', leftover.id, liveIds) });
    } else if (!liveIds.length) {
      out.push(leftover);
    }
  }

  return out;
}

export async function resolveNimModel(id: string): Promise<string> {
  return resolveModelId('nim', id, await listCatalogueIds());
}

// ── Retrieval NIMs (embeddings + reranking) ─────────────────────────────────

export const EMBED_MODEL = 'nvidia/llama-3.2-nv-embedqa-1b-v2';
export const RERANK_MODEL = 'nvidia/llama-3.2-nv-rerankqa-1b-v2';

export async function embed(
  texts: string[],
  inputType: 'query' | 'passage' = 'passage',
  model = EMBED_MODEL,
): Promise<number[][]> {
  const res = await fetch(`${NIM_RETRIEVAL_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ input: texts, model, input_type: inputType, encoding_format: 'float', truncate: 'END' }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new ProviderError(`NIM embedding failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400), {
      status: res.status,
      code: 'nim_embed_failed',
      retryable: res.status >= 500,
    });
  }
  const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
  return (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function rerank(
  query: string,
  passages: string[],
  model = RERANK_MODEL,
): Promise<Array<{ index: number; score: number }>> {
  const res = await fetch(`${NIM_RETRIEVAL_BASE}/ranking`, {
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
    throw new ProviderError(`NIM reranker failed: ${res.status}`, {
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
        mode: 'base',
        width: opts.width ?? 1024,
        height: opts.height ?? 1024,
        steps: opts.steps ?? 30,
        seed: opts.seed ?? 0,
        cfg_scale: opts.cfgScale ?? 3.5,
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

  const b64 =
    json.image ??
    json.artifacts?.[0]?.base64 ??
    json.data?.[0]?.b64_json ??
    null;

  if (!b64) {
    throw new ProviderError(`NIM image model ${model} returned no artifact.`, { code: 'nim_image_empty' });
  }

  return {
    dataUrl: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`,
    model,
    seed: json.artifacts?.[0]?.seed,
  };
}

/** Convenience wrapper for internal single-shot calls (planning, classification). */
export async function nimComplete(req: Omit<ChatRequest, 'provider'>): Promise<{ content: string; reasoning: string }> {
  const model = await resolveNimModel(req.model);
  return completeChat(nimChatConfig(), { ...req, provider: 'nim', stream: false }, model);
}
