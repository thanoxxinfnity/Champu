import type { ModelCapability, ModelDescriptor, ProviderId } from './types';

/**
 * Bundled model registry.
 *
 * This is metadata only — the *authoritative* list comes from a live
 * `GET /v1/models` probe against NVIDIA NIM (see `nim.ts#listCatalogue`).
 * Vendors add and retire model ids constantly, so anything here is a fallback
 * and a source of capability annotations for ids the catalogue returns bare.
 *
 * Where the product brief named a model that NVIDIA does not publish, the name
 * is kept as an *alias* that resolves to the closest shipping model, and says so
 * in the UI. Silently pretending an id exists produces 404s at runtime, so we
 * surface the substitution instead.
 */

const CHAT: ModelCapability[] = ['chat', 'tools'];
const REASON: ModelCapability[] = ['chat', 'tools', 'reasoning'];

export const NIM_MODELS: ModelDescriptor[] = [
  // ── Moonshot (Kimi) ────────────────────────────────────────────────────────
  {
    id: 'moonshotai/kimi-k2-thinking',
    provider: 'nim',
    label: 'Kimi K2 Thinking',
    vendor: 'Moonshot AI',
    capabilities: REASON,
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'moonshotai/kimi-k2-instruct',
    provider: 'nim',
    label: 'Kimi K2 Instruct',
    vendor: 'Moonshot AI',
    capabilities: CHAT,
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'kimi-k3',
    provider: 'nim',
    label: 'Kimi K3 (alias)',
    vendor: 'Moonshot AI',
    capabilities: REASON,
    emitsReasoning: true,
    origin: 'alias',
    resolvesTo: 'moonshotai/kimi-k2-thinking',
    note: 'NVIDIA does not publish a "Kimi K3" NIM. Routed to the newest Kimi reasoning build in the live catalogue.',
  },

  // ── Zhipu / Z.ai (GLM) ─────────────────────────────────────────────────────
  {
    id: 'zai-org/glm-4.6',
    provider: 'nim',
    label: 'GLM-4.6',
    vendor: 'Zhipu AI',
    capabilities: REASON,
    contextWindow: 200_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'thudm/glm-4-9b-chat',
    provider: 'nim',
    label: 'GLM-4 9B Chat',
    vendor: 'Zhipu AI',
    capabilities: CHAT,
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'glm-5',
    provider: 'nim',
    label: 'GLM-5 (alias)',
    vendor: 'Zhipu AI',
    capabilities: REASON,
    emitsReasoning: true,
    origin: 'alias',
    resolvesTo: 'zai-org/glm-4.6',
    note: 'No GLM-5 NIM is published. Routed to the highest GLM build in the live catalogue.',
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  {
    id: 'deepseek-ai/deepseek-r1',
    provider: 'nim',
    label: 'DeepSeek-R1',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'deepseek-ai/deepseek-v3.1',
    provider: 'nim',
    label: 'DeepSeek-V3.1',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'deepseek-ai/deepseek-r1-distill-llama-8b',
    provider: 'nim',
    label: 'DeepSeek-R1 Distill Llama 8B',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 32_000,
    emitsReasoning: true,
    origin: 'static',
  },

  // ── Meta ───────────────────────────────────────────────────────────────────
  {
    id: 'meta/llama-3.3-70b-instruct',
    provider: 'nim',
    label: 'Llama 3.3 70B Instruct',
    vendor: 'Meta',
    capabilities: CHAT,
    contextWindow: 128_000,
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

  // ── NVIDIA Nemotron ────────────────────────────────────────────────────────
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    provider: 'nim',
    label: 'Nemotron 70B Instruct',
    vendor: 'NVIDIA',
    capabilities: CHAT,
    contextWindow: 128_000,
    origin: 'static',
  },
  {
    id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    provider: 'nim',
    label: 'Nemotron Super 49B v1.5',
    vendor: 'NVIDIA',
    capabilities: REASON,
    contextWindow: 128_000,
    emitsReasoning: true,
    origin: 'static',
  },

  // ── Coding specialists ─────────────────────────────────────────────────────
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    provider: 'nim',
    label: 'Qwen3 Coder 480B',
    vendor: 'Alibaba',
    capabilities: CHAT,
    contextWindow: 256_000,
    origin: 'static',
  },

  // ── Retrieval stack (powers Workdrive search-augmented generation) ─────────
  {
    id: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
    provider: 'nim',
    label: 'NV-EmbedQA 1B v2',
    vendor: 'NVIDIA',
    capabilities: ['embedding'],
    origin: 'static',
  },
  {
    id: 'nvidia/llama-3.2-nv-rerankqa-1b-v2',
    provider: 'nim',
    label: 'NV-RerankQA 1B v2',
    vendor: 'NVIDIA',
    capabilities: ['rerank'],
    origin: 'static',
  },

  // ── Image generation ──────────────────────────────────────────────────────
  {
    id: 'black-forest-labs/flux.1-dev',
    provider: 'nim',
    label: 'FLUX.1 [dev]',
    vendor: 'Black Forest Labs',
    capabilities: ['image'],
    origin: 'static',
  },
  {
    id: 'stabilityai/stable-diffusion-3-5-large',
    provider: 'nim',
    label: 'Stable Diffusion 3.5 Large',
    vendor: 'Stability AI',
    capabilities: ['image'],
    origin: 'static',
  },
];

export const POLLINATIONS_MODELS: ModelDescriptor[] = [
  {
    id: 'openai',
    provider: 'pollinations',
    label: 'Pollinations · Default',
    vendor: 'Pollinations',
    capabilities: ['chat', 'vision'],
    origin: 'static',
  },
  {
    id: 'openai-fast',
    provider: 'pollinations',
    label: 'Pollinations · Fast',
    vendor: 'Pollinations',
    capabilities: ['chat'],
    origin: 'static',
  },
  {
    id: 'openai-reasoning',
    provider: 'pollinations',
    label: 'Pollinations · Reasoning',
    vendor: 'Pollinations',
    capabilities: REASON,
    emitsReasoning: true,
    origin: 'static',
  },
  {
    id: 'searchgpt',
    provider: 'pollinations',
    label: 'Pollinations · Search',
    vendor: 'Pollinations',
    capabilities: ['chat', 'search'],
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

/**
 * Resolve an alias to a concrete id. `catalogue` is the live model list; when a
 * newer build of the aliased family is present we prefer it over the pinned
 * `resolvesTo` so the alias tracks the vendor instead of rotting.
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
  if (/embed/.test(l)) return ['embedding'];
  if (/rerank/.test(l)) return ['rerank'];
  if (/flux|stable-diffusion|sdxl|consistory|image/.test(l)) return ['image'];
  if (/vision|vl-|-vl|multimodal/.test(l)) return ['chat', 'vision', 'tools'];
  if (/r1|thinking|reasoning|nemotron-super|glm-4\.[6-9]|qwq|deepseek-v3\.[1-9]/.test(l)) return REASON;
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
    'zai-org': 'Zhipu AI',
    'thudm': 'Zhipu AI',
    'deepseek-ai': 'DeepSeek',
    'meta': 'Meta',
    'nvidia': 'NVIDIA',
    'qwen': 'Alibaba',
    'mistralai': 'Mistral',
    'google': 'Google',
    'microsoft': 'Microsoft',
    'black-forest-labs': 'Black Forest Labs',
    'stabilityai': 'Stability AI',
  };
  return map[head] ?? head;
}
