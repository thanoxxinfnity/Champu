import { modelIdsFrom, modelListCandidates } from './model-list';
import type { UpstreamConfig } from './openai-compat';
import { inferCapabilities, labelFor, vendorFor } from './registry';
import { ProviderError, type CustomEndpointConfig, type ModelCapability, type ModelDescriptor } from './types';

/**
 * Universal custom model gateway.
 *
 * Accepts any OpenAI-compatible base URL plus arbitrary auth headers, then
 * *probes* it to discover which capabilities it exposes. When a probe finds
 * 3D / video / audio generation, the workspace instantiates a dedicated tool tab
 * for it (see `useCapabilityTabs`).
 */

/** Blocks SSRF into link-local metadata services and loopback. */
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata.goog']);

export function assertSafeEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderError(`"${baseUrl}" is not a valid URL. Include the scheme, e.g. https://api.example.com/v1`, {
      status: 400,
      code: 'custom_bad_url',
    });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderError(`Unsupported scheme "${url.protocol}". Use http or https.`, {
      status: 400,
      code: 'custom_bad_scheme',
    });
  }
  if (BLOCKED_HOSTS.has(url.hostname)) {
    throw new ProviderError('That host is blocked (cloud metadata endpoint).', {
      status: 403,
      code: 'custom_blocked_host',
    });
  }
  return url;
}

/** Header names the gateway controls itself; a user header must not clobber them. */
const RESERVED = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

export function customHeaders(cfg: CustomEndpointConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    if (!k || RESERVED.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  if (cfg.apiKey && !Object.keys(out).some((k) => k.toLowerCase() === 'authorization')) {
    out.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return out;
}

export function customChatConfig(cfg: CustomEndpointConfig): UpstreamConfig {
  const base = assertSafeEndpoint(cfg.baseUrl).toString().replace(/\/+$/, '');
  const path = (cfg.chatPath ?? '/chat/completions').replace(/^\/?/, '/');
  return {
    url: `${base}${path}`,
    headers: customHeaders(cfg),
    supportsStreaming: true,
    timeoutMs: 300_000,
    shapeBody: (body) => {
      delete body.stream_options; // unknown to many self-hosted servers
      return body;
    },
  };
}

// ── Dynamic capability detection ───────────────────────────────────────────

export interface CapabilityProbe {
  ok: boolean;
  baseUrl: string;
  /** Union of capabilities across all discovered models. */
  capabilities: ModelCapability[];
  models: ModelDescriptor[];
  /** Endpoint paths that answered, e.g. `/images/generations`. */
  routes: string[];
  latencyMs: number;
  error?: string;
}

/** Route → capability map used to light up dedicated workspace tabs. */
const ROUTE_CAPABILITIES: Array<{ path: string; capability: ModelCapability; method: 'GET' | 'OPTIONS' }> = [
  { path: '/images/generations', capability: 'image', method: 'OPTIONS' },
  { path: '/videos/generations', capability: 'video', method: 'OPTIONS' },
  { path: '/video/generations', capability: 'video', method: 'OPTIONS' },
  { path: '/audio/speech', capability: 'audio', method: 'OPTIONS' },
  { path: '/audio/transcriptions', capability: 'audio', method: 'OPTIONS' },
  { path: '/3d/generations', capability: 'model3d', method: 'OPTIONS' },
  { path: '/models/3d', capability: 'model3d', method: 'GET' },
  { path: '/embeddings', capability: 'embedding', method: 'OPTIONS' },
];

/** Keyword → capability map for ids returned by `/models`. */
const ID_CAPABILITY_HINTS: Array<[RegExp, ModelCapability]> = [
  [/(^|[-_/])(video|sora|veo|kling|runway|wan|cogvideo|hunyuan-?video|ltx)/i, 'video'],
  [/(^|[-_/])(3d|trellis|shap-?e|point-?e|triposr|hunyuan3d|mesh|gaussian)/i, 'model3d'],
  [/(^|[-_/])(tts|whisper|audio|speech|voice|bark|musicgen|xtts)/i, 'audio'],
  [/(^|[-_/])(flux|sd\d|sdxl|stable-?diffusion|dall-?e|imagen|image|midjourney)/i, 'image'],
  [/(^|[-_/])(embed|bge|gte|e5)/i, 'embedding'],
  [/(^|[-_/])(rerank|reranker)/i, 'rerank'],
  [/(^|[-_/])(vision|vl|multimodal|llava)/i, 'vision'],
];

function capabilitiesFromId(id: string): ModelCapability[] {
  const hits = ID_CAPABILITY_HINTS.filter(([re]) => re.test(id)).map(([, cap]) => cap);
  return hits.length ? Array.from(new Set(hits)) : inferCapabilities(id);
}

/**
 * Probe a custom endpoint. Never throws for a *reachable* endpoint that simply
 * lacks features — an unreachable one returns `ok: false` with a readable reason
 * so Settings can show it inline instead of blowing up.
 */
export async function probeEndpoint(cfg: CustomEndpointConfig): Promise<CapabilityProbe> {
  const started = Date.now();
  let base: string;
  try {
    base = assertSafeEndpoint(cfg.baseUrl).toString().replace(/\/+$/, '');
  } catch (err) {
    return {
      ok: false,
      baseUrl: cfg.baseUrl,
      capabilities: [],
      models: [],
      routes: [],
      latencyMs: 0,
      error: (err as Error).message,
    };
  }

  const headers = customHeaders(cfg);
  const capabilities = new Set<ModelCapability>();
  const routes: string[] = [];
  let models: ModelDescriptor[] = [];

  // 1. The model list.
  //
  // "<base>/models with an OpenAI envelope" is the common case, not the only
  // one, and assuming it was the reason perfectly working endpoints came back
  // as "answered nothing". kie.ai, for one, serves chat at /v1/chat/completions
  // but lists its models at /api/v1/models — a different prefix entirely — and
  // wraps them as { data: { models: [{ model }] } }. So several plausible paths
  // are tried, and several envelopes are accepted.
  try {
    let res: Response | null = null;
    let usedPath = '';

    for (const path of modelListCandidates(base)) {
      try {
        const attempt = await fetch(path.url, { headers, signal: AbortSignal.timeout(12_000) });
        // Auth failures are conclusive — stop and report rather than trying
        // every other path and blaming the route.
        if (attempt.status === 401 || attempt.status === 403) {
          return {
            ok: false,
            baseUrl: base,
            capabilities: [],
            models: [],
            routes: [],
            latencyMs: Date.now() - started,
            error: `Endpoint rejected the credentials (${attempt.status}). Check the API key or custom auth header.`,
          };
        }
        if (!attempt.ok) continue;
        const ids = modelIdsFrom(await attempt.clone().json().catch(() => null));
        if (!ids.length) continue;
        res = attempt;
        usedPath = path.label;
        break;
      } catch {
        // Unreachable path; try the next.
      }
    }

    if (res) {
      routes.push(usedPath);
      const ids = modelIdsFrom(await res.json().catch(() => null));

      models = ids.map((id) => {
        const caps = capabilitiesFromId(id);
        return {
          id,
          provider: 'custom' as const,
          label: labelFor(id),
          vendor: vendorFor(id),
          capabilities: caps,
          emitsReasoning: caps.includes('reasoning'),
          origin: 'catalogue' as const,
        };
      });
      for (const m of models) for (const c of m.capabilities) capabilities.add(c);
    }
  } catch (err) {
    return {
      ok: false,
      baseUrl: base,
      capabilities: [],
      models: [],
      routes: [],
      latencyMs: Date.now() - started,
      error: `Could not reach ${base}: ${(err as Error).message}`,
    };
  }

  // 2. Route sniffing for modalities that /models does not always advertise.
  await Promise.all(
    ROUTE_CAPABILITIES.map(async ({ path, capability, method }) => {
      try {
        const res = await fetch(`${base}${path}`, { method, headers, signal: AbortSignal.timeout(8_000) });
        // 404/501 => absent. Anything else (incl. 400/405/422) => the route exists.
        if (res.status !== 404 && res.status !== 501) {
          capabilities.add(capability);
          if (!routes.includes(path)) routes.push(path);
        }
      } catch {
        /* a single dead probe must not fail the whole detection */
      }
    }),
  );

  // Chat is the floor: if anything answered at all, assume completions work.
  if (routes.length) capabilities.add('chat');

  return {
    ok: routes.length > 0,
    baseUrl: base,
    capabilities: Array.from(capabilities),
    models,
    routes,
    latencyMs: Date.now() - started,
    error: routes.length ? undefined : 'Endpoint answered nothing on /models or any known generation route.',
  };
}


