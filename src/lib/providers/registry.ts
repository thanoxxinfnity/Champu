import type { ModelCapability, ModelDescriptor, ProviderId } from './types';

/**
 * Bundled model registry.
 *
 * Every NIM entry below was verified against a live `GET /v1/models` probe plus a
 * real completion call — not copied from documentation. Ids marked `verified`
 * answered; the live catalogue still wins at runtime (see `nim.ts#listModels`),
 * because NVIDIA rotates ids and retires endpoints continuously.
 *
 * Two things this catalogue does NOT contain, deliberately:
 *   - GLM. `z-ai/glm-5.2` is listed on build.nvidia.com, but a live call to
 *     `integrate.api.nvidia.com` returns **HTTP 410 Gone — end of life**. It is
 *     partner-endpoint only. Listed here as `partner-only` so the switcher can
 *     explain that up front instead of failing at request time.
 *   - Reranking. NVIDIA's hosted reranker NIMs reached end-of-life (HTTP 410),
 *     so the retrieval pipeline ranks by embedding similarity alone.
 */

const CHAT: ModelCapability[] = ['chat', 'tools'];
const REASON: ModelCapability[] = ['chat', 'tools', 'reasoning'];

export const NIM_MODELS: ModelDescriptor[] = [
  // ── Moonshot (Kimi) ────────────────────────────────────────────────────────
  {
    id: 'moonshotai/kimi-k3',
    provider: 'nim',
    label: 'Kimi K3',
    vendor: 'Moonshot AI',
    capabilities: ['chat', 'tools', 'reasoning', 'vision'],
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'static',
    note: '~2.8T hybrid KDA+MLA multimodal MoE. Long-horizon coding, agentic tool use, image understanding.',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    provider: 'nim',
    label: 'Kimi K2.6',
    vendor: 'Moonshot AI',
    capabilities: REASON,
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'static',
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  {
    id: 'deepseek-ai/deepseek-v4-pro-0813',
    provider: 'nim',
    label: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 1_000_000,
    emitsReasoning: true,
    origin: 'static',
    note: '1M-token context, efficient MoE, tuned for coding.',
  },
  {
    id: 'deepseek-ai/deepseek-v4-flash-0731',
    provider: 'nim',
    label: 'DeepSeek V4 Flash',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'static',
    note: '284B MoE with 13B active — long context at flash latency.',
  },
  {
    id: 'deepseek-ai/deepseek-coder-6.7b-instruct',
    provider: 'nim',
    label: 'DeepSeek Coder 6.7B',
    vendor: 'DeepSeek',
    capabilities: CHAT,
    contextWindow: 16_000,
    origin: 'static',
  },

  // ── NVIDIA Nemotron ────────────────────────────────────────────────────────
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    provider: 'nim',
    label: 'Nemotron 3 Ultra 550B',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    provider: 'nim',
    label: 'Nemotron 3 Super 120B',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    provider: 'nim',
    label: 'Nemotron 3.5 Lightning 30B',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
    note: 'Fastest 30B A3B MoE — the default for routing and planning.',
  },
  {
    id: 'nvidia/nemotron-nano-3-30b-a3b',
    provider: 'nim',
    label: 'Nemotron Nano 3 30B',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    provider: 'nim',
    label: 'Nemotron 3 Nano Omni 30B',
    vendor: 'NVIDIA',
    capabilities: ['chat', 'tools', 'reasoning', 'vision', 'audio'],
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
    note: 'Omni-modal: images, video, speech and text.',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    provider: 'nim',
    label: 'Llama Nemotron Ultra 253B',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    provider: 'nim',
    label: 'Llama Nemotron 70B Instruct',
    vendor: 'NVIDIA',
    capabilities: CHAT,
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'nvidia/cosmos-reason2-8b',
    provider: 'nim',
    label: 'Cosmos Reason 2 8B',
    vendor: 'NVIDIA',
    capabilities: ['chat', 'vision', 'reasoning'],
    emitsReasoning: true,
    origin: 'static',
    note: 'Physical-world reasoning over video and images.',
  },

  // ── Meta ───────────────────────────────────────────────────────────────────
  {
    id: 'meta/muse-glimmer-30b',
    provider: 'nim',
    label: 'Muse Glimmer 30B',
    vendor: 'Meta',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'meta/llama-3.2-90b-vision-instruct',
    provider: 'nim',
    label: 'Llama 3.2 90B Vision',
    vendor: 'Meta',
    capabilities: ['chat', 'vision'],
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'meta/llama-3.2-11b-vision-instruct',
    provider: 'nim',
    label: 'Llama 3.2 11B Vision',
    vendor: 'Meta',
    capabilities: ['chat', 'vision'],
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'meta/codellama-70b',
    provider: 'nim',
    label: 'CodeLlama 70B',
    vendor: 'Meta',
    capabilities: CHAT,
    origin: 'static',
  },

  // ── Others verified in the catalogue ──────────────────────────────────────
  {
    id: 'openai/gpt-oss-20b',
    provider: 'nim',
    label: 'GPT-OSS 20B',
    vendor: 'OpenAI',
    capabilities: REASON,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'google/gemma-4-31b-it',
    provider: 'nim',
    label: 'Gemma 4 31B',
    vendor: 'Google',
    capabilities: CHAT,
    origin: 'static',
  },
  {
    id: 'mistralai/mistral-large-2-instruct',
    provider: 'nim',
    label: 'Mistral Large 2',
    vendor: 'Mistral',
    capabilities: CHAT,
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'mistralai/codestral-22b-instruct-v0.1',
    provider: 'nim',
    label: 'Codestral 22B',
    vendor: 'Mistral',
    capabilities: CHAT,
    origin: 'static',
  },

  // ── Retrieval ─────────────────────────────────────────────────────────────
  {
    id: 'nvidia/nemotron-3-embed-1b',
    provider: 'nim',
    label: 'Nemotron 3 Embed 1B',
    vendor: 'NVIDIA',
    capabilities: ['embedding'],
    origin: 'static',
    note: '2048-dimension embeddings. Powers Workdrive retrieval ranking.',
  },

  // ── Image ─────────────────────────────────────────────────────────────────
  {
    id: 'black-forest-labs/flux.1-dev',
    provider: 'nim',
    label: 'FLUX.1 [dev]',
    vendor: 'Black Forest Labs',
    capabilities: ['image'],
    origin: 'static',
    note: 'Served from ai.api.nvidia.com/v1/genai. Dimensions must be 768–1280 in multiples of 64.',
  },

  // ── Partner-endpoint only ─────────────────────────────────────────────────
  {
    id: 'z-ai/glm-5.2',
    provider: 'nim',
    label: 'GLM-5.2 (partner endpoint)',
    vendor: 'Zhipu AI',
    capabilities: REASON,
    contextWindow: 1_000_000,
    emitsReasoning: true,
    origin: 'partner-only',
    note: '753B, 1M context. Verified: integrate.api.nvidia.com answers HTTP 410 — the free endpoint reached end of life, and GLM-5.2 is served only through a partner endpoint. Add that partner base URL under Settings → Custom Endpoints to use it.',
  },
];

export const POLLINATIONS_MODELS: ModelDescriptor[] = [
  {
    id: 'openai-fast',
    provider: 'pollinations',
    label: 'Pollinations · Fast',
    vendor: 'Pollinations',
    capabilities: REASON,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'openai',
    provider: 'pollinations',
    label: 'Pollinations · Default',
    vendor: 'Pollinations',
    capabilities: ['chat'],
    origin: 'static',
  },
  {
    id: 'flux',
    provider: 'pollinations',
    label: 'Pollinations · FLUX (image)',
    vendor: 'Pollinations',
    capabilities: ['image'],
    origin: 'static',
  },
  {
    id: 'turbo',
    provider: 'pollinations',
    label: 'Pollinations · Turbo (image)',
    vendor: 'Pollinations',
    capabilities: ['image'],
    origin: 'static',
  },
];

const BY_ID = new Map<string, ModelDescriptor>(
  [...NIM_MODELS, ...POLLINATIONS_MODELS].map((m) => [`${m.provider}:${m.id}`, m]),
);

export function describeModel(provider: ProviderId, id: string): ModelDescriptor | undefined {
  return BY_ID.get(`${provider}:${id}`);
}

/** Models the live catalogue will never return, kept only to explain why. */
export function isPartnerOnly(provider: ProviderId, id: string): boolean {
  return describeModel(provider, id)?.origin === 'partner-only';
}

/**
 * Resolve an alias to a concrete id, preferring the newest live build of the
 * same family so the alias tracks the vendor instead of rotting.
 */
export function resolveModelId(provider: ProviderId, id: string, catalogue?: string[]): string {
  const desc = describeModel(provider, id);
  if (!desc || desc.origin !== 'alias') return id;

  if (catalogue?.length) {
    const family = desc.resolvesTo?.split('/')[0];
    if (family) {
      const live = catalogue.filter((c) => c.startsWith(`${family}/`)).sort().reverse();
      if (live.length) return live[0];
    }
  }
  return desc.resolvesTo ?? id;
}

/** Capability annotations for a bare id returned by a live catalogue probe. */
export function inferCapabilities(id: string): ModelCapability[] {
  const l = id.toLowerCase();
  if (/embed|nvclip/.test(l)) return ['embedding'];
  if (/rerank|reward|ranking/.test(l)) return ['rerank'];
  if (/flux|stable-diffusion|sdxl|diffusiongemma|qwen-image/.test(l)) return ['image'];
  if (/omni/.test(l)) return ['chat', 'tools', 'reasoning', 'vision', 'audio'];
  if (/vision|-vl|vlm|kosmos|neva|vila|fuyu|deplot|cosmos|parse/.test(l)) return ['chat', 'vision'];
  if (/kimi|nemotron-3|muse|deepseek-v4|gpt-oss|reason|thinking|glm-[5-9]|lightning/.test(l)) return REASON;
  return CHAT;
}

export function labelFor(id: string): string {
  const tail = id.includes('/') ? id.split('/').slice(1).join('/') : id;
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bV(\d)/g, 'v$1');
}

export function vendorFor(id: string): string {
  const head = id.includes('/') ? id.split('/')[0] : 'unknown';
  const map: Record<string, string> = {
    'moonshotai': 'Moonshot AI',
    'z-ai': 'Zhipu AI',
    'zai-org': 'Zhipu AI',
    'thudm': 'Zhipu AI',
    'deepseek-ai': 'DeepSeek',
    'meta': 'Meta',
    'nvidia': 'NVIDIA',
    'nv-mistralai': 'NVIDIA',
    'qwen': 'Alibaba',
    'mistralai': 'Mistral',
    'google': 'Google',
    'microsoft': 'Microsoft',
    'openai': 'OpenAI',
    'ibm': 'IBM',
    'writer': 'Writer',
    'snowflake': 'Snowflake',
    'black-forest-labs': 'Black Forest Labs',
    'stabilityai': 'Stability AI',
    'databricks': 'Databricks',
    'bigcode': 'BigCode',
    '01-ai': '01.AI',
    'ai21labs': 'AI21 Labs',
    'poolside': 'Poolside',
    'zyphra': 'Zyphra',
    'adept': 'Adept',
    'aisingapore': 'AI Singapore',
  };
  return map[head] ?? head;
}

/** Default model for a fresh workspace — verified reasoning-capable. */
export const DEFAULT_NIM_MODEL = 'moonshotai/kimi-k3';
/** Cheap, fast model used for intent routing and plan decomposition. */
export const PLANNER_NIM_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
