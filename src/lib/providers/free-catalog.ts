import type { EndpointRecord } from '@/lib/db/schema';
import type { Dialect } from './dialects.ts';
import { FREE_CATALOG_DATA } from './free-catalog.data.ts';

/**
 * The free-provider catalogue: every LLM API with a permanent free tier from github.com/mnfst/awesome-free-llm-apis
 * (CC0 1.0, refreshed with `node scripts/sync-free-catalog.mjs`), turned into endpoints the app can call.
 *
 * The list says *what* each provider offers. This file says *how to call it*, which the list does not: which wire
 * protocol, which providers work with no key at all, which need an account id, and what a key looks like (so a pile of
 * pasted keys can be sorted by provider). Connecting a provider writes an ordinary custom endpoint with its models, so
 * everything that already works with custom endpoints works with these, and the gateway can then mix them.
 */

interface RawModel {
  id: string;
  context: string;
  maxOutput: string;
  modality: string;
  rateLimit: string;
}

interface RawProvider {
  id: string;
  name: string;
  category: 'provider_api' | 'inference_provider';
  flag: string;
  signupUrl: string;
  baseUrl: string;
  description: string;
  note: string;
  models: RawModel[];
}

export interface FreeModel {
  id: string;
  context: string;
  modality: string;
  rateLimit: string;
  capabilities: string[];
  /** Listed by the provider but not usable on the free plan (the list's footnote says so). */
  paid: boolean;
}

export interface FreeProvider {
  id: string;
  name: string;
  category: 'provider_api' | 'inference_provider';
  flag: string;
  /** The provider's page for getting a key. */
  signupUrl: string;
  /** What the list publishes. */
  baseUrl: string;
  /** What the app calls; an OpenAI-compatible route where the published one is not. `{account_id}` is filled in on connect. */
  chatBase: string;
  dialect: Dialect;
  /**
   * key      — a key is needed.
   * keyless  — works with no key (anonymous, rate-limited); a key only raises the limits.
   * builtin  — NVIDIA NIM, which the app already has its own provider and key field for.
   */
  access: 'key' | 'keyless' | 'builtin';
  needsAccountId: boolean;
  /** Where the key is found / what it looks like. */
  keyHint: string;
  description: string;
  note: string;
  /** 0..1: how much the gateway trusts this provider's limits and speed when it has a choice. */
  weight: number;
  models: FreeModel[];
}

interface Override {
  chatBase?: string;
  dialect?: Dialect;
  access?: FreeProvider['access'];
  needsAccountId?: boolean;
  keyHint: string;
  weight: number;
  /** Models the list says need a paid plan. */
  paid?: string[];
}

const OVERRIDES: Record<string, Override> = {
  'aion-labs': { keyHint: 'aionlabs.ai → API keys', weight: 0.35 },
  cohere: {
    chatBase: 'https://api.cohere.ai/compatibility/v1',
    keyHint: 'dashboard.cohere.com → API keys (a Trial key, 1,000 calls a month, not for commercial use)',
    weight: 0.4,
  },
  'google-gemini': { dialect: 'gemini', keyHint: 'aistudio.google.com → Get API key (starts with AIza)', weight: 0.9 },
  'mistral-ai': { keyHint: 'console.mistral.ai → API keys (the Free plan)', weight: 0.8 },
  'z-ai': { keyHint: 'open.bigmodel.cn → API keys', weight: 0.5 },
  'cloudflare-workers-ai': {
    chatBase: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    needsAccountId: true,
    keyHint: 'dash.cloudflare.com → AI → Workers AI → Use REST API: your Account ID and an API token with Workers AI permission',
    weight: 0.6,
    paid: [
      '@cf/moonshotai/kimi-k2.6',
      '@cf/moonshotai/kimi-k2.7-code',
      '@cf/zai-org/glm-5.2',
      '@cf/zai-org/glm-5.3',
      '@cf/zai-org/glm-5.3-flash',
      '@cf/deepseek-ai/deepseek-v4-flash-0731',
      '@cf/deepseek-ai/deepseek-v4-pro-0813',
    ],
  },
  'gonka-broker': { keyHint: 'gonkabroker.com → sign up (phone verification) → API key', weight: 0.3 },
  groq: { keyHint: 'console.groq.com → API Keys (starts with gsk_)', weight: 0.95 },
  'hugging-face': { keyHint: 'huggingface.co/settings/tokens → a token with “Inference Providers” permission (starts with hf_)', weight: 0.5 },
  'kilo-code': { access: 'keyless', keyHint: 'No key needed. kilo.ai → API keys raises the limits', weight: 0.5 },
  'llm7-io': { access: 'keyless', keyHint: 'No key needed. token.llm7.io gives a free token for higher limits', weight: 0.55 },
  modelscope: { keyHint: 'modelscope.cn → Access tokens (needs an Alibaba Cloud account and real-name verification)', weight: 0.3 },
  'nvidia-nim': { access: 'builtin', keyHint: 'build.nvidia.com → API key (starts with nvapi-). Saved under Settings → API Keys', weight: 0.85 },
  'ollama-cloud': { chatBase: 'https://ollama.com/v1', keyHint: 'ollama.com/settings/keys → Add API key', weight: 0.6 },
  openrouter: { keyHint: 'openrouter.ai/keys → Create key (starts with sk-or-)', weight: 0.7 },
  'ovhcloud-ai-endpoints': { access: 'keyless', keyHint: 'No key needed (2 requests a minute per model). A key lifts the limit but is billed', weight: 0.3 },
  siliconflow: { keyHint: 'cloud.siliconflow.cn → API keys (needs identity verification)', weight: 0.35 },
};

/** Key shapes that identify one provider unambiguously; anything else has to be named. */
const KEY_PREFIXES: Array<[string, string]> = [
  ['AIza', 'google-gemini'],
  ['gsk_', 'groq'],
  ['hf_', 'hugging-face'],
  ['nvapi-', 'nvidia-nim'],
  ['sk-or-', 'openrouter'],
];

/** Names people type for a provider. */
const ALIASES: Record<string, string> = {
  gemini: 'google-gemini',
  google: 'google-gemini',
  aistudio: 'google-gemini',
  hf: 'hugging-face',
  huggingface: 'hugging-face',
  nim: 'nvidia-nim',
  nvidia: 'nvidia-nim',
  ovh: 'ovhcloud-ai-endpoints',
  ovhcloud: 'ovhcloud-ai-endpoints',
  llm7: 'llm7-io',
  kilo: 'kilo-code',
  kilocode: 'kilo-code',
  zai: 'z-ai',
  zhipu: 'z-ai',
  glm: 'z-ai',
  bigmodel: 'z-ai',
  cloudflare: 'cloudflare-workers-ai',
  cf: 'cloudflare-workers-ai',
  workersai: 'cloudflare-workers-ai',
  mistral: 'mistral-ai',
  ollama: 'ollama-cloud',
  aion: 'aion-labs',
  gonka: 'gonka-broker',
};

/** What a catalogue modality means for the app. A comma list ("Text, Image, Audio, Embeddings") is the provider's range, not the model's. */
export function capabilitiesFor(modality: string): string[] {
  const m = modality.toLowerCase().trim();
  if (/^embeddings?$/.test(m)) return ['embedding'];
  const caps = ['chat'];
  if (m.includes(',')) return caps;
  if (m.includes('reasoning')) caps.push('reasoning');
  if (/image|vision|multimodal/.test(m)) caps.push('vision');
  return caps;
}

const raw = FREE_CATALOG_DATA as unknown as { source: CatalogSource; providers: RawProvider[] };

export interface CatalogSource {
  repo: string;
  commit: string;
  lastUpdated: string;
  licence: string;
}

export const FREE_CATALOG_SOURCE: CatalogSource = raw.source;

const PROVIDERS: FreeProvider[] = raw.providers.map((p) => {
  const o = OVERRIDES[p.id] ?? { keyHint: '', weight: 0.4 };
  const paid = new Set(o.paid ?? []);
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    flag: p.flag,
    signupUrl: p.signupUrl,
    baseUrl: p.baseUrl,
    chatBase: o.chatBase ?? p.baseUrl,
    dialect: o.dialect ?? 'openai',
    access: o.access ?? 'key',
    needsAccountId: o.needsAccountId ?? false,
    keyHint: o.keyHint,
    description: p.description,
    note: p.note,
    weight: o.weight,
    models: p.models.map((m) => ({
      id: m.id,
      context: m.context,
      modality: m.modality,
      rateLimit: m.rateLimit,
      capabilities: capabilitiesFor(m.modality),
      paid: paid.has(m.id),
    })),
  };
});

export function freeProviders(): FreeProvider[] {
  return PROVIDERS;
}

export function freeProvider(id: string): FreeProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** The id of the endpoint a provider is stored as: one per provider, so connecting again updates it. */
export function endpointIdFor(providerId: string): string {
  return `free-${providerId}`;
}

/** The models of a provider the app should offer: chat-capable and usable on the free plan. */
export function usableModels(p: FreeProvider): FreeModel[] {
  return p.models.filter((m) => m.capabilities.includes('chat') && !m.paid);
}

export interface ConnectInput {
  keys?: string[];
  accountId?: string;
  now?: number;
  /** A real message came back from this provider with these settings. */
  verified?: boolean;
  /** Models to keep when the endpoint already exists, with their on/off state. */
  keepModels?: EndpointRecord['models'];
}

/** The base URL to call, with the account id filled in; null while a required account id is missing. */
export function resolvedBase(p: FreeProvider, accountId?: string): string | null {
  if (!p.chatBase.includes('{account_id}')) return p.chatBase;
  const id = (accountId ?? '').trim();
  return /^[0-9a-f]{32}$/i.test(id) ? p.chatBase.replace('{account_id}', id) : null;
}

/** An endpoint for this provider. Throws when something it needs (an account id) is missing. */
export function buildEndpoint(p: FreeProvider, input: ConnectInput = {}): EndpointRecord {
  const base = resolvedBase(p, input.accountId);
  if (!base) throw new Error(`${p.name} needs your Cloudflare Account ID (32 characters, from dash.cloudflare.com).`);
  const keys = [...new Set((input.keys ?? []).map((k) => k.trim()).filter(Boolean))];
  if (p.access === 'key' && !keys.length) throw new Error(`${p.name} needs an API key. ${p.keyHint}`);
  const now = input.now ?? Date.now();
  const keep = new Map((input.keepModels ?? []).map((m) => [m.id, m]));
  const models = usableModels(p).map((m) => ({
    id: m.id,
    label: m.id,
    capabilities: m.capabilities,
    ...(keep.has(m.id) && keep.get(m.id)!.enabled === false ? { enabled: false } : {}),
  }));
  // Models a live refresh added earlier stay, with whatever on/off state the user gave them.
  for (const m of input.keepModels ?? []) if (!models.some((x) => x.id === m.id)) models.push(m);
  return {
    id: endpointIdFor(p.id),
    freeId: p.id,
    label: p.name,
    baseUrl: base,
    apiKey: keys[0],
    apiKeys: keys.length > 1 ? keys.slice(1) : undefined,
    dialect: p.dialect,
    capabilities: ['chat'],
    models,
    routes: ['from awesome-free-llm-apis'],
    lastProbedAt: input.verified ? now : undefined,
    probeOk: input.verified ? 1 : 0,
    enabled: 1,
    createdAt: now,
  };
}

/** Which provider a key belongs to, when its shape says so. */
export function detectProviderByKey(key: string): string | null {
  const k = key.trim();
  for (const [prefix, id] of KEY_PREFIXES) if (k.startsWith(prefix)) return id;
  return null;
}

/** "groq", "Google Gemini", "hf" … → a catalogue id. */
export function resolveProviderName(name: string): string | null {
  const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!flat) return null;
  if (ALIASES[flat]) return ALIASES[flat];
  for (const p of PROVIDERS) {
    if (p.id.replace(/-/g, '') === flat || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === flat) return p.id;
  }
  return null;
}

export interface PastedKey {
  providerId: string;
  key: string;
  accountId?: string;
}

/**
 * Sorts a pasted pile of keys by provider.
 *
 * One per line: `groq: gsk_…`, `openrouter = sk-or-…`, `cloudflare: <account id>:<token>`, or just a key whose shape
 * names its provider (`AIza…`, `gsk_…`, `hf_…`, `nvapi-…`, `sk-or-…`). Several lines for one provider become several keys
 * for it (the gateway rotates them). Lines that cannot be placed come back in `unknown` so nothing is silently dropped.
 */
export function parseKeyPaste(text: string): { entries: PastedKey[]; unknown: string[] } {
  const entries: PastedKey[] = [];
  const unknown: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const named = /^([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*[:=]\s*(\S.*)$/.exec(t);
    let providerId: string | null = null;
    let key = t;
    if (named) {
      const id = resolveProviderName(named[1]);
      if (id) {
        providerId = id;
        key = named[2].trim();
      }
    }
    if (!providerId) providerId = detectProviderByKey(key);
    if (!providerId) {
      unknown.push(t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-3)}` : t);
      continue;
    }
    const p = freeProvider(providerId)!;
    if (p.needsAccountId) {
      const m = /^([0-9a-f]{32})\s*[:\s]\s*(\S+)$/i.exec(key);
      if (!m) {
        unknown.push(`${p.name}: needs "<account id>:<token>"`);
        continue;
      }
      entries.push({ providerId, key: m[2], accountId: m[1] });
      continue;
    }
    entries.push({ providerId, key: key.replace(/^["']|["']$/g, '') });
  }
  return { entries, unknown };
}
