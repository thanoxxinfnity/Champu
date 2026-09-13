import {
  authHeaders,
  chatUrl,
  dialectFromUrl,
  DIALECT_LABELS,
  DIALECTS,
  hasAuthHeader,
  modelIdsFromList,
  modelListUrl,
  normalizeBase as normalizeForDialect,
  type Dialect,
} from './dialects.ts';
import { chatBaseCandidates, chatModelsOnly, modelIdsFrom, modelListCandidates, normalizeBase } from './model-list.ts';
import type { UpstreamConfig } from './openai-compat.ts';
import { inferCapabilities, labelFor, vendorFor } from './registry.ts';
import { ProviderError, type CustomEndpointConfig, type ModelCapability, type ModelDescriptor } from './types.ts';

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

export function customHeaders(cfg: CustomEndpointConfig, dialect?: Dialect): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    if (!k || RESERVED.has(k.toLowerCase())) continue;
    out[k] = v;
  }

  // Each dialect authenticates with its own header: Anthropic reads x-api-key
  // and requires anthropic-version, Gemini reads x-goog-api-key. Sending a
  // Bearer token to either is a 401 every time — which is half of why a working
  // key looked like a broken endpoint.
  const spoken = dialect ?? cfg.dialect ?? 'openai';
  if (!hasAuthHeader(spoken, out)) Object.assign(out, authHeaders(spoken, cfg.apiKey));
  else if (spoken === 'anthropic' && !Object.keys(out).some((k) => k.toLowerCase() === 'anthropic-version')) {
    Object.assign(out, { 'anthropic-version': authHeaders('anthropic')['anthropic-version'] });
  }
  return out;
}

export function customChatConfig(cfg: CustomEndpointConfig, modelId = ''): UpstreamConfig {
  // The stored base can still be a pasted endpoint (added by hand, without a
  // probe), and appending /chat/completions to /v1/chat/completions asks for a
  // route that does not exist.
  const dialect: Dialect = cfg.dialect ?? dialectFromUrl(cfg.baseUrl) ?? 'openai';
  const base = assertSafeEndpoint(normalizeForDialect(cfg.baseUrl, dialect)).toString().replace(/\/+$/, '');

  // An explicit chatPath is the user overriding detection, and only makes sense
  // for the OpenAI shape — the other two put the model in the path themselves.
  const url =
    cfg.chatPath && dialect === 'openai'
      ? `${base}${cfg.chatPath.replace(/^\/?/, '/')}`
      : chatUrl(dialect, base, modelId, true);

  return {
    url,
    // Gemini routes streaming and non-streaming to different paths, so the URL
    // cannot be decided until the request is made.
    urlFor: cfg.chatPath && dialect === 'openai' ? undefined : (stream) => chatUrl(dialect, base, modelId, stream),
    headers: customHeaders(cfg, dialect),
    dialect,
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
  /** Which wire protocol answered. Stored with the endpoint and used for chat. */
  dialect?: Dialect;
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
    // A pasted endpoint is not a base. People copy the URL from the docs —
    // ".../v1/models" or ".../v1/chat/completions" — and taking it literally
    // makes the probe ask for "/v1/models/models", then blames the endpoint.
    base = assertSafeEndpoint(normalizeBase(cfg.baseUrl)).toString().replace(/\/+$/, '');
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

  const capabilities = new Set<ModelCapability>();
  const routes: string[] = [];
  let models: ModelDescriptor[] = [];

  // Which protocol this endpoint actually speaks.
  //
  // Only one of three is OpenAI's. An Anthropic gateway serves /v1/messages and
  // reads x-api-key; Gemini puts the model in the path and reads x-goog-api-key.
  // Asking either in OpenAI's dialect 404s the route or 401s the key, and the
  // endpoint gets blamed for a protocol mismatch. The URL usually announces
  // which it is; when it does not, each is tried in turn.
  const hinted = cfg.dialect ?? dialectFromUrl(cfg.baseUrl);
  const order: Dialect[] = hinted ? [hinted, ...DIALECTS.filter((d) => d !== hinted)] : DIALECTS;

  let dialect: Dialect = hinted ?? 'openai';
  let spoken = false;

  for (const candidate of order) {
    const candidateBase = normalizeForDialect(cfg.baseUrl, candidate);
    const answer = await speaks(candidate, candidateBase, customHeaders(cfg, candidate));
    if (!answer.ok) {
      if (answer.auth) {
        return {
          ok: false,
          baseUrl: candidateBase,
          dialect: candidate,
          capabilities: [],
          models: [],
          routes: [],
          latencyMs: Date.now() - started,
          error: `Endpoint rejected the credentials (${answer.status}). Check the API key, or the custom auth header if the endpoint wants its own.`,
        };
      }
      continue;
    }
    dialect = candidate;
    base = candidateBase;
    spoken = true;
    routes.push(answer.route);
    break;
  }

  const headers = customHeaders(cfg, dialect);

  // Which base can actually be talked to.
  //
  // The model list and the chat route need not share a prefix — kie.ai serves
  // chat at /v1/chat/completions and lists models at /api/v1/models — so a base
  // derived from one is wrong for the other. Picking the wrong one leaves an
  // endpoint that probes perfectly and then cannot answer a single message,
  // which is the worst of both.
  if (dialect === 'openai' && !spoken) {
    const chatBase = await findChatBase(base, headers);
    if (chatBase && chatBase !== base) {
      base = chatBase;
      routes.push(`chat at ${new URL(chatBase).pathname || '/'}`);
    } else if (chatBase) {
      routes.push('/chat/completions');
    }
  }

  // A non-OpenAI endpoint publishes its models at its own path, in its own
  // shape, and none of the OpenAI-shaped fallbacks apply.
  if (dialect !== 'openai') {
    const ids = await listModelsFor(dialect, base, headers);
    if (ids.length) {
      routes.push('/models');
      models = ids.map((id) => describeModel(id));
      for (const m of models) for (const c of m.capabilities) capabilities.add(c);
    }
    capabilities.add('chat');
    return {
      ok: routes.length > 0,
      baseUrl: base,
      dialect,
      capabilities: Array.from(capabilities),
      models,
      routes,
      latencyMs: Date.now() - started,
      error: routes.length
        ? undefined
        : `Nothing answered at ${base} in the ${dialect} dialect. Check the base URL and the key; you can still add the endpoint and type the model id by hand.`,
    };
  }

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
      // A gateway's list is everything it can do, not everything it can chat
      // with. Offering its video and image models in a chat switcher is how a
      // user picks one that cannot answer.
      const ids = chatModelsOnly(modelIdsFrom(await res.json().catch(() => null)));

      models = ids.map((id) => describeModel(id));
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
    dialect,
    capabilities: Array.from(capabilities),
    models,
    routes,
    latencyMs: Date.now() - started,
    error: routes.length
      ? undefined
      : `Nothing answered at ${base} — no model list on /models or /api/v1/models, and no chat route. ` +
        'Check the base URL and the key; you can still add the endpoint and type the model id by hand.',
  };
}




/**
 * The base whose `/chat/completions` exists.
 *
 * Existence is inferred from the refusal: a 404 or 501 means the route is not
 * there, and anything else — including a 400 about the model, or a 401 about
 * the key — means it is. That is deliberately generous, because the point is to
 * find the route, not to make a successful completion at probe time.
 */
async function findChatBase(base: string, headers: Record<string, string>): Promise<string | null> {
  for (const candidate of chatBaseCandidates(base)) {
    try {
      const res = await fetch(`${candidate}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '__chomugiri_probe__', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(12_000),
      });

      if (res.status === 404 || res.status === 501) continue;

      // Some gateways answer 200 with the error in the body; a "no route"
      // message there means the same as a 404.
      if (res.ok) {
        const body = await res.clone().text().catch(() => '');
        if (/not supported|no route|not found/i.test(body) && /"code"\s*:\s*(404|501)/.test(body)) continue;
      }

      return candidate;
    } catch {
      // Unreachable; try the next.
    }
  }
  return null;
}


/** One model descriptor, however the id was discovered. */
function describeModel(id: string): ModelDescriptor {
  const caps = capabilitiesFromId(id);
  return {
    id,
    provider: 'custom',
    label: labelFor(id),
    vendor: vendorFor(id),
    capabilities: caps,
    emitsReasoning: caps.includes('reasoning'),
    origin: 'catalogue',
  };
}

/**
 * Whether an endpoint answers in a given dialect.
 *
 * Existence is inferred from the refusal, not from a successful completion: a
 * 404 or 501 means the route is not there, and anything else — a 400 about the
 * model, a 422 about the id — means it is. A 401 or 403 is conclusive in the
 * other direction: the route exists and the credentials were refused, which is
 * worth reporting rather than trying two more protocols and blaming the URL.
 */
async function speaks(
  dialect: Dialect,
  base: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; route: string; status?: number; auth?: boolean }> {
  const probeModel = dialect === 'gemini' ? 'gemini-3-flash' : '__chomugiri_probe__';
  const url = chatUrl(dialect, base, probeModel, false);

  const body =
    dialect === 'anthropic'
      ? { model: probeModel, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }
      : dialect === 'gemini'
        ? { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
        : { model: probeModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, route: '', status: res.status, auth: true };
    }
    if (res.status === 404 || res.status === 501 || res.status === 405) return { ok: false, route: '' };

    // Some gateways answer 200 with the error in the body; a "no route" message
    // there means the same as a 404.
    if (res.ok) {
      const text = await res.clone().text().catch(() => '');
      if (/not supported|no route|not found/i.test(text) && /"code"\s*:\s*(404|501)/.test(text)) {
        return { ok: false, route: '' };
      }
    }

    const path = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();
    return { ok: true, route: dialect === 'openai' ? '/chat/completions' : `${DIALECT_LABELS[dialect]} at ${path}` };
  } catch {
    return { ok: false, route: '' };
  }
}

/** The model list, read in the dialect's own shape. */
async function listModelsFor(dialect: Dialect, base: string, headers: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(modelListUrl(dialect, base), { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    return modelIdsFromList(dialect, await res.json().catch(() => null));
  } catch {
    return [];
  }
}
