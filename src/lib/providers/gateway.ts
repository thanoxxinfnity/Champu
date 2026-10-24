import type { EndpointRecord } from '@/lib/db/schema';
import { endpointConfigFor } from './endpoint-models.ts';
import { freeProvider } from './free-catalog.ts';
import type { CustomEndpointConfig, ModelDescriptor, ProviderId } from './types.ts';

/**
 * The gateway: one provider in the model list that stands for all of them.
 *
 * Picking "Auto" does not name a model. At send time the gateway looks at every model the user has connected (the built-in
 * NVIDIA NIM and Pollinations, plus every custom endpoint, including the free providers) and builds an ordered list
 * of candidates for the kind of job: the best available first, spread across providers so no single free tier carries
 * the load, with the next in line ready. If one answers 429, runs out of quota, rejects the key, does not know the model or
 * is down, it is set aside for a while and the next one is tried — before a single word has been shown. When an endpoint has
 * several keys, they are used in turn and a key that is refused is skipped, so several free accounts add up to one bigger one.
 *
 * Everything here is pure (no network, no storage, the clock is passed in) so it can be tested; the transport that
 * uses it is in chat-client.ts.
 */

export type GatewayKind = 'auto' | 'fast' | 'code' | 'reasoning' | 'vision';

export const GATEWAY_ENDPOINT_ID = 'gateway';
export const GATEWAY_VENDOR = 'Gateway';
export const GATEWAY_PREFIX = 'gateway/';

export const GATEWAY_KINDS: Array<{ kind: GatewayKind; label: string; note: string }> = [
  { kind: 'auto', label: 'Auto — best available', note: 'A strong model from any provider you connected; falls back to the next when one is busy or out of quota.' },
  { kind: 'fast', label: 'Auto — fastest', note: 'Small, quick models first. For short answers and quick edits.' },
  { kind: 'code', label: 'Auto — coding', note: 'Models built for code first, then the strongest general ones.' },
  { kind: 'reasoning', label: 'Auto — thinking', note: 'Reasoning models first, for hard problems and plans.' },
  { kind: 'vision', label: 'Auto — sees images', note: 'Only models that accept images.' },
];

/** The picker entries for the gateway. */
export function gatewayModels(): ModelDescriptor[] {
  return GATEWAY_KINDS.map(({ kind, label, note }) => ({
    id: `${GATEWAY_PREFIX}${kind}`,
    provider: 'custom' as ProviderId,
    label: `${GATEWAY_VENDOR} · ${label}`,
    vendor: GATEWAY_VENDOR,
    capabilities: kind === 'reasoning' ? ['chat', 'reasoning'] : kind === 'vision' ? ['chat', 'vision'] : ['chat'],
    emitsReasoning: kind === 'reasoning',
    origin: 'catalogue' as const,
    endpointId: GATEWAY_ENDPOINT_ID,
    note,
  }));
}

/** Which kind of gateway a selection is, or null when it is an ordinary model. */
export function gatewayKind(model: string, provider?: string): GatewayKind | null {
  if (provider !== undefined && provider !== 'custom') return null;
  if (!model.startsWith(GATEWAY_PREFIX)) return null;
  const kind = model.slice(GATEWAY_PREFIX.length);
  return GATEWAY_KINDS.some((k) => k.kind === kind) ? (kind as GatewayKind) : null;
}

// ── What a model is, from its name ──────────────────────────────────────────

export interface Traits {
  /** Total parameters in billions, read from the name or guessed from the family. */
  sizeB: number;
  /** Parameters used per token (for a mixture of experts), when the name says. */
  activeB: number;
  quick: boolean;
  code: boolean;
  reasoning: boolean;
  vision: boolean;
}

const FAMILY_SIZE: Array<[RegExp, number]> = [
  [/ultra|opus|kimi-k[23]|deepseek-v[34]-pro|command-a-plus|glm-5/, 400],
  [/deepseek-v[34]|minimax-m2|qwen3?\.?[5-9]-?max|\bmax\b/, 300],
  [/-pro\b|\bpro$|sonnet|command-a\b/, 200],
  [/large|\bplus\b|\bglm-4/, 120],
  [/gemini-[0-9.]+-flash(?!-lite)/, 60],
  [/turbo|flash(?!-lite)|\bscout\b|\bmedium\b/, 50],
  [/mini|small|lite|haiku|\bflash-lite\b|\bnano\b|tiny|instant/, 20],
];

const QUICK = /flash|lite|mini|nano|turbo|instant|small|haiku|fast|lightning|\b(?:3|4|7|8|9|12|14|20)b\b/;
const CODE = /code|coder|codestral|devstral|laguna|starcoder|north-mini|kimi-k2\.7-code/;
const THINK = /thinking|reasoning|reasoner|\br1\b|-r1|gpt-oss|think|nemotron-3.*(?:ultra|super)|\bo[134]\b/;

export function traitsOf(id: string, label: string, capabilities: string[]): Traits {
  const name = `${id} ${label}`.toLowerCase();
  const sizes = [...name.matchAll(/(?<![a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/g)].map((m) => Number(m[1]));
  const active = [...name.matchAll(/(?<![a-z0-9])a(\d+(?:\.\d+)?)b(?![a-z])/g)].map((m) => Number(m[1]));
  let sizeB = sizes.length ? Math.max(...sizes) : 0;
  if (!sizeB) {
    for (const [re, b] of FAMILY_SIZE) {
      if (re.test(name)) {
        sizeB = b;
        break;
      }
    }
  }
  if (!sizeB) sizeB = 40;
  const activeB = active.length ? Math.min(...active) : sizeB;
  return {
    sizeB,
    activeB,
    quick: QUICK.test(name) || activeB <= 20,
    code: CODE.test(name),
    reasoning: capabilities.includes('reasoning') || THINK.test(name),
    vision: capabilities.includes('vision'),
  };
}

/** How good a model is for this kind of job: roughly 0..12, larger is better. */
export function scoreFor(kind: GatewayKind, t: Traits): number {
  const tier = Math.min(Math.log2(Math.max(t.sizeB, 1)), 9.5);
  switch (kind) {
    case 'fast': {
      const speed = 6 - Math.abs(Math.log2(Math.max(t.activeB, 1)) - Math.log2(20)) * 0.8;
      return speed + (t.quick ? 1.5 : 0) - (t.reasoning ? 1.2 : 0) + tier * 0.15;
    }
    case 'code':
      return tier * 0.8 + (t.code ? 3.2 : 0) + (t.reasoning ? 0.3 : 0);
    case 'reasoning':
      return tier * 0.6 + (t.reasoning ? 4.5 : -2);
    case 'vision':
    case 'auto':
    default:
      return tier + (t.reasoning ? 0.4 : 0);
  }
}

/** Built-in providers have no catalogue entry; how much the gateway trusts them. */
const BUILTIN_WEIGHT: Record<string, number> = { nim: 0.85, pollinations: 0.45 };

export function providerWeight(provider: string, freeId?: string): number {
  if (freeId) return freeProvider(freeId)?.weight ?? 0.5;
  return BUILTIN_WEIGHT[provider] ?? 0.6;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// ── Health: who is cooling off, and why ─────────────────────────────────────

export interface Health {
  /** key → time until which it is set aside */
  until: Map<string, number>;
  /** key → how many times in a row it failed (for the back-off) */
  strikes: Map<string, { n: number; at: number }>;
  /** per-kind and per-endpoint round-robin counters */
  keyTurn: Map<string, number>;
  /** keys the provider refused, kept so the UI can say so */
  refused: Set<string>;
  /** why something is resting, for the status panel */
  why: Map<string, FailureClass | 'limit'>;
  /** per model and key: when each call happened and how many tokens it used (last 24 hours), to stay under the published limits */
  calls: Map<string, Array<{ at: number; tokens: number }>>;
}

export function createHealth(): Health {
  return { until: new Map(), strikes: new Map(), keyTurn: new Map(), refused: new Set(), why: new Map(), calls: new Map() };
}

// ── The published limits ────────────────────────────────────────────────────

export interface Limits {
  rpm?: number;
  rph?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
}

function amount(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM])?/.exec(text.replace(/,/g, ''));
  if (!m) return 0;
  return Math.round(Number(m[1]) * (m[2] ? (/[kK]/.test(m[2]) ? 1e3 : 1e6) : 1));
}

/** Reads the catalogue's rate-limit text ("30 RPM, 14.4K RPD, 6K TPM") into numbers; what it does not say stays unlimited. */
export function parseRateLimit(text: string | undefined): Limits {
  const out: Limits = {};
  for (const m of (text ?? '').matchAll(/(\d[\d.,]*\s*[kKmM]?)\s*(RPM|RPH|RPD|TPM|TPD)\b/gi)) {
    const n = amount(m[1]);
    if (n > 0) out[m[2].toLowerCase() as keyof Limits] = n;
  }
  return out;
}

const callKey = (c: Pick<Candidate, 'provider' | 'model' | 'endpointId' | 'keyIndex'>) => `c:${c.endpointId ?? c.provider}|${c.keyIndex}|${c.model}`;

/** Remembers one call (and its tokens) so the next plan knows how much of the free allowance is gone. */
export function noteCall(health: Health, c: Candidate, tokens: number, now: number): void {
  const key = callKey(c);
  const log = (health.calls.get(key) ?? []).filter((x) => now - x.at < 24 * 60 * MINUTE);
  log.push({ at: now, tokens });
  health.calls.set(key, log);
}

/** When this model/key may be used again if its published limits say it is used up now, else 0. */
export function limitUntil(health: Health, c: Candidate, limits: Limits, now: number): number {
  const log = health.calls.get(callKey(c)) ?? [];
  if (!log.length) return 0;
  let until = 0;
  const within = (ms: number) => log.filter((x) => now - x.at < ms);
  const check = (ms: number, max: number | undefined, measure: (x: { at: number; tokens: number }) => number, margin = 1) => {
    if (!max) return;
    const inside = within(ms);
    let used = inside.reduce((n, x) => n + measure(x), 0);
    if (used < max * margin) return;
    // the window frees up when enough of the oldest calls fall out of it
    for (const x of inside) {
      used -= measure(x);
      if (used < max * margin) {
        until = Math.max(until, x.at + ms);
        return;
      }
    }
    until = Math.max(until, now + ms);
  };
  const one = () => 1;
  const tok = (x: { tokens: number }) => x.tokens;
  check(MINUTE, limits.rpm, one);
  check(60 * MINUTE, limits.rph, one);
  check(24 * 60 * MINUTE, limits.rpd, one);
  check(MINUTE, limits.tpm, tok, 0.9);
  check(24 * 60 * MINUTE, limits.tpd, tok, 0.9);
  return until > now ? until : 0;
}

function limitsOf(freeId: string | undefined, model: string): Limits {
  if (!freeId) return {};
  return parseRateLimit(freeProvider(freeId)?.models.find((m) => m.id === model)?.rateLimit);
}

export interface Candidate {
  provider: ProviderId;
  model: string;
  /** Shown to the user: "Groq · llama-3.3-70b-versatile". */
  label: string;
  vendor: string;
  endpointId?: string;
  custom?: CustomEndpointConfig;
  /** Which of the endpoint's keys this attempt uses; -1 when it has none. */
  keyIndex: number;
  score: number;
}

const modelKey = (c: Pick<Candidate, 'provider' | 'model' | 'endpointId'>) => `m:${c.endpointId ?? c.provider}|${c.model}`;
const keyKey = (endpointId: string, index: number) => `k:${endpointId}|${index}`;

export function endpointKeys(e: Pick<EndpointRecord, 'apiKey' | 'apiKeys'>): string[] {
  return [e.apiKey, ...(e.apiKeys ?? [])].map((k) => (k ?? '').trim()).filter(Boolean);
}

export interface PlanInput {
  models: ModelDescriptor[];
  endpoints: EndpointRecord[];
  health: Health;
  now: number;
  /** Turns the first few equally good picks so successive requests use different providers. */
  rotation?: number;
  maxAttempts?: number;
}

/** The endpoints the app may use: with the free-APIs switch off, every endpoint that came from the free catalogue sits out. */
export function activeEndpoints<T extends { freeId?: string }>(endpoints: T[], freeApis: boolean): T[] {
  return freeApis ? endpoints : endpoints.filter((e) => !e.freeId);
}

/**
 * The ordered list of things to try for this kind of job.
 *
 * Best first, but each round takes at most one model per provider: a chain made of one provider's twenty models would
 * all die together when that provider does.
 */
export function planCandidates(kind: GatewayKind, input: PlanInput): Candidate[] {
  const { models, endpoints, health, now } = input;
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  const scored: Candidate[] = [];

  for (const m of models) {
    if (!m.capabilities.includes('chat') || m.origin === 'partner-only') continue;
    if (m.endpointId === GATEWAY_ENDPOINT_ID) continue;
    if (kind === 'vision' && !m.capabilities.includes('vision')) continue;
    const t = traitsOf(m.id, m.label, m.capabilities);
    const cooling = (key: string) => (health.until.get(key) ?? 0) > now;

    let custom: CustomEndpointConfig | undefined;
    let keyIndex = -1;
    let freeId: string | undefined;
    let vendor = m.vendor;
    if (m.provider === 'custom') {
      const endpoint = m.endpointId ? byId.get(m.endpointId) : undefined;
      if (!endpoint || !endpoint.enabled) continue;
      const base = endpointConfigFor(endpoints, { provider: 'custom', endpointId: endpoint.id });
      if (!base) continue;
      freeId = endpoint.freeId;
      vendor = endpoint.label;
      const keys = endpointKeys(endpoint);
      if (keys.length) {
        const start = health.keyTurn.get(endpoint.id) ?? 0;
        let pick = -1;
        const limits = limitsOf(freeId, m.id);
        for (let i = 0; i < keys.length; i++) {
          const idx = (start + i) % keys.length;
          if (cooling(keyKey(endpoint.id, idx))) continue;
          // this key has already used up what the provider publishes for this model: leave it alone until the window frees up
          const probe = { provider: m.provider, model: m.id, endpointId: endpoint.id, keyIndex: idx };
          if (limitUntil(health, probe as Candidate, limits, now) > 0) continue;
          pick = idx;
          break;
        }
        if (pick < 0) continue; // every key of this provider is resting
        keyIndex = pick;
        custom = { ...base, apiKey: keys[pick] };
      } else {
        if (cooling(keyKey(endpoint.id, -1))) continue;
        const probe = { provider: m.provider, model: m.id, endpointId: endpoint.id, keyIndex: -1 };
        if (limitUntil(health, probe as Candidate, limitsOf(freeId, m.id), now) > 0) continue;
        custom = { ...base, apiKey: undefined };
      }
    } else if (cooling(keyKey(m.provider, -1))) {
      continue;
    }

    const cand: Candidate = {
      provider: m.provider,
      model: m.id,
      label: `${vendor} · ${m.id}`,
      vendor,
      endpointId: m.provider === 'custom' ? m.endpointId : undefined,
      custom,
      keyIndex,
      score: scoreFor(kind, t) + 3 * providerWeight(m.provider, freeId),
    };
    if (cooling(modelKey(cand))) continue;
    scored.push(cand);
  }

  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  // Round-robin over providers: the best of each, then the second best of each…
  const groups = new Map<string, Candidate[]>();
  for (const c of scored) {
    const g = c.endpointId ?? c.provider;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }
  const chain: Candidate[] = [];
  const queues = [...groups.values()];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    const layer = queues.map((q) => q[round]).filter(Boolean).sort((a, b) => b.score - a.score);
    chain.push(...layer);
  }

  // Equally good first picks take turns, so the load spreads across providers.
  const rotation = input.rotation ?? 0;
  if (chain.length > 1) {
    const top = chain[0].score;
    let band = 1;
    while (band < Math.min(chain.length, 5) && chain[band].score >= top - 1.2) band++;
    if (band > 1) {
      const turn = ((rotation % band) + band) % band;
      chain.unshift(...chain.splice(turn, 1));
    }
  }

  return chain.slice(0, input.maxAttempts ?? 8);
}

// ── Failures ────────────────────────────────────────────────────────────────

export type FailureClass = 'cancel' | 'rate' | 'quota' | 'auth' | 'model' | 'server' | 'client';

export interface Failure {
  status?: number;
  code?: string;
  message: string;
  retryAfterMs?: number;
}

function statusOf(f: Failure): number | undefined {
  // The app's route wraps an upstream failure in its own status (a 502 for Gemini's "400 API key not valid"), but the
  // message it carries starts with the upstream status. That one is the truth.
  const lead = /^(\d{3})\s/.exec(f.message.trim());
  if (lead && (!f.status || f.status === 502)) return Number(lead[1]);
  if (f.status) return f.status;
  const m = /^(?:http|upstream)_(\d{3})$/.exec(f.code ?? '');
  if (m) return Number(m[1]);
  const inText = /\b(?:returned|answered|status|error|http)\s*:?\s*(\d{3})\b/i.exec(f.message);
  return inText ? Number(inText[1]) : undefined;
}

/** What kind of trouble an error is, because each one is handled differently. */
export function classifyError(f: Failure): FailureClass {
  const msg = f.message.toLowerCase();
  const status = statusOf(f);
  if (/run cancelled|aborterror|aborted by/.test(msg)) return 'cancel';
  if (/daily|per day|\brpd\b|quota|exhaust|insufficient|credit|billing|monthly|per month|neurons|usage limit|free (?:tier|allocation)/.test(msg) && (status === undefined || [402, 403, 429].includes(status))) return 'quota';
  if (status === 402) return 'quota';
  if (status === 429 || /rate.?limit|too many requests|\brpm\b|\btpm\b|slow down/.test(msg)) return 'rate';
  if (status === 401 || status === 403 || /invalid.{0,12}(?:api )?key|api key (?:is )?(?:not valid|invalid|expired|revoked)|api_key_invalid|incorrect api key|bad api key|unauthori[sz]ed|forbidden|permission denied|authentication|no auth credentials/.test(msg)) return 'auth';
  if (
    status === 404 ||
    f.code === 'model_unsupported' ||
    /model.{0,30}(?:not found|not supported|unavailable|does not exist|unknown|not available)|no such model|unsupported model|function .{0,60}not found/.test(msg)
  ) {
    return 'model';
  }
  if ((status && status >= 500) || f.code === 'empty_completion' || /timeout|timed out|unreachable|network|fetch failed|interrupted|overloaded|temporarily|empty (?:completion|reply)|bad gateway|try again/.test(msg)) return 'server';
  return 'client';
}

function strike(health: Health, key: string, now: number, forgetAfter = 10 * MINUTE): number {
  const prev = health.strikes.get(key);
  const n = prev && now - prev.at < forgetAfter ? prev.n + 1 : 1;
  health.strikes.set(key, { n, at: now });
  return n;
}

function rest(health: Health, key: string, now: number, ms: number, why: FailureClass | 'limit'): void {
  health.until.set(key, Math.max(health.until.get(key) ?? 0, now + ms));
  health.why.set(key, why);
}

/** Sets aside what failed, for as long as the kind of failure suggests. */
export function reportFailure(health: Health, c: Candidate, cls: FailureClass, now: number, retryAfterMs?: number): void {
  if (cls === 'cancel' || cls === 'client') return;
  const mk = modelKey(c);
  const owner = c.endpointId ?? c.provider;
  const key = keyKey(owner, c.keyIndex);
  switch (cls) {
    case 'rate': {
      const n = strike(health, mk, now, 5 * MINUTE);
      rest(health, mk, now, Math.max(retryAfterMs ?? 0, Math.min(MINUTE * 2 ** (n - 1), 10 * MINUTE)), 'rate');
      // three different models refused by one key within two minutes: it is the key that is spent
      if (strike(health, `kr:${key}`, now, 2 * MINUTE) >= 3) rest(health, key, now, 5 * MINUTE, 'rate');
      break;
    }
    case 'quota': {
      rest(health, mk, now, 30 * MINUTE, 'quota');
      if (strike(health, `kq:${key}`, now, 30 * MINUTE) >= 2) rest(health, key, now, 15 * MINUTE, 'quota');
      break;
    }
    case 'auth': {
      rest(health, key, now, 60 * MINUTE, 'auth');
      health.refused.add(key);
      break;
    }
    case 'model': {
      const n = strike(health, mk, now, 60 * MINUTE);
      rest(health, mk, now, n > 1 ? 60 * MINUTE : 10 * MINUTE, 'model');
      break;
    }
    case 'server': {
      const n = strike(health, mk, now, 10 * MINUTE);
      rest(health, mk, now, Math.min(30 * SECOND * 2 ** (n - 1), 10 * MINUTE), 'server');
      break;
    }
  }
}

/** A model that answered is trusted again, and the next request starts on the endpoint's next key. */
export function reportSuccess(health: Health, c: Candidate, keyCount = 1): void {
  const mk = modelKey(c);
  health.until.delete(mk);
  health.strikes.delete(mk);
  if (c.endpointId && c.keyIndex >= 0 && keyCount > 1) health.keyTurn.set(c.endpointId, (c.keyIndex + 1) % keyCount);
}

export interface Tried {
  candidate: Candidate;
  cls: FailureClass;
  message: string;
}

export type AttemptResult<T> = { ok: true; value: T } | { ok: false; error: Failure; emitted?: boolean };

export interface FailoverOutcome<T> {
  ok: boolean;
  value?: T;
  used?: Candidate;
  tried: Tried[];
  lastError?: string;
}

/**
 * Tries the plan in order until one answers.
 *
 * Moves on after any failure except a cancel, and after anything that already put words on the screen (a reply cannot be
 * un-sent, so a stream that breaks halfway is reported, not retried on another model).
 */
export async function runWithFailover<T>(
  plan: Candidate[],
  health: Health,
  attempt: (c: Candidate) => Promise<AttemptResult<T>>,
  opts: { now?: () => number; keyCountOf?: (c: Candidate) => number; onSwitch?: (from: Candidate, error: string) => void } = {},
): Promise<FailoverOutcome<T>> {
  const now = opts.now ?? Date.now;
  const tried: Tried[] = [];
  for (const c of plan) {
    const r = await attempt(c);
    if (r.ok) {
      reportSuccess(health, c, opts.keyCountOf?.(c) ?? 1);
      return { ok: true, value: r.value, used: c, tried };
    }
    const cls = classifyError(r.error);
    tried.push({ candidate: c, cls, message: r.error.message });
    reportFailure(health, c, cls, now(), r.error.retryAfterMs);
    if (cls === 'cancel' || r.emitted) return { ok: false, tried, lastError: r.error.message };
    opts.onSwitch?.(c, r.error.message);
  }
  const last = tried[tried.length - 1];
  return {
    ok: false,
    tried,
    lastError: last
      ? `No connected model answered (${tried.length} tried). Last: ${last.candidate.label} — ${last.message}`
      : 'No model is available for the gateway yet. Connect a provider under Settings → Free LLM APIs (some need no key).',
  };
}

// ── What is resting ─────────────────────────────────────────────────────────

export interface RestingItem {
  /** "Groq · llama-3.3-70b" or "Groq (key 2)" */
  what: string;
  why: string;
  until: number;
}

const WHY_TEXT: Record<FailureClass | 'limit', string> = {
  cancel: 'cancelled',
  client: 'bad request',
  rate: 'rate limit hit',
  quota: 'free quota used up',
  auth: 'key refused',
  model: 'model not available',
  server: 'provider is down or slow',
  limit: 'at its published limit',
};

/** Everything the gateway is setting aside right now, soonest to return first — for the status panel. */
export function restingNow(health: Health, endpoints: Array<Pick<EndpointRecord, 'id' | 'label' | 'models' | 'apiKey' | 'apiKeys' | 'freeId'>>, now: number, labelOf: (owner: string) => string = (o) => o): RestingItem[] {
  const out: RestingItem[] = [];
  const owner = (id: string) => endpoints.find((e) => e.id === id)?.label ?? labelOf(id);
  for (const [key, until] of health.until) {
    if (until <= now) continue;
    const why = WHY_TEXT[health.why.get(key) ?? 'server'];
    if (key.startsWith('m:')) {
      const [o, model] = key.slice(2).split('|');
      out.push({ what: `${owner(o)} · ${model}`, why, until });
    } else if (key.startsWith('k:')) {
      const [o, idx] = key.slice(2).split('|');
      const e = endpoints.find((x) => x.id === o);
      const many = e ? endpointKeys(e).length > 1 : false;
      out.push({ what: Number(idx) >= 0 && many ? `${owner(o)} (key ${Number(idx) + 1})` : owner(o), why, until });
    }
  }
  // Local view of the published limits: who is at their free allowance without having been refused yet.
  for (const e of endpoints) {
    if (!e.freeId) continue;
    const keys = endpointKeys(e);
    const idxs = keys.length ? keys.map((_, i) => i) : [-1];
    for (const m of e.models) {
      const limits = limitsOf(e.freeId, m.id);
      if (!Object.keys(limits).length) continue;
      const waits = idxs.map((i) => limitUntil(health, { provider: 'custom', model: m.id, endpointId: e.id, keyIndex: i } as Candidate, limits, now));
      if (waits.every((w) => w > 0)) out.push({ what: `${e.label} · ${m.id}`, why: WHY_TEXT.limit, until: Math.min(...waits) });
    }
  }
  return out.sort((a, b) => a.until - b.until);
}

// ── Token counter ───────────────────────────────────────────────────────────

export interface Totals {
  prompt: number;
  completion: number;
  calls: number;
}

export interface UsageState {
  since: number;
  total: Totals;
  byProvider: Record<string, Totals>;
  byModel: Record<string, Totals>;
  /** YYYY-MM-DD → tokens */
  byDay: Record<string, number>;
  /** What the user has in total across providers; the meter is measured against it. */
  budget?: number;
}

export function emptyUsage(now = Date.now()): UsageState {
  return { since: now, total: { prompt: 0, completion: 0, calls: 0 }, byProvider: {}, byModel: {}, byDay: {} };
}

/** The usual 4-characters-a-token estimate, for providers that do not report usage. */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function bump(map: Record<string, Totals>, key: string, prompt: number, completion: number): void {
  const t = (map[key] ??= { prompt: 0, completion: 0, calls: 0 });
  t.prompt += prompt;
  t.completion += completion;
  t.calls += 1;
}

/** A new state with this call counted (the old one is not touched). */
export function addUsage(
  state: UsageState,
  who: { provider: string; model: string },
  tokens: { prompt: number; completion: number },
  now = Date.now(),
): UsageState {
  const next: UsageState = {
    ...state,
    total: { ...state.total },
    byProvider: structuredCloneRecord(state.byProvider),
    byModel: structuredCloneRecord(state.byModel),
    byDay: { ...state.byDay },
  };
  const prompt = Math.max(0, Math.round(tokens.prompt));
  const completion = Math.max(0, Math.round(tokens.completion));
  next.total.prompt += prompt;
  next.total.completion += completion;
  next.total.calls += 1;
  bump(next.byProvider, who.provider, prompt, completion);
  bump(next.byModel, `${who.provider} · ${who.model}`, prompt, completion);
  const d = day(now);
  next.byDay[d] = (next.byDay[d] ?? 0) + prompt + completion;
  // keep the record small: 90 days, the 120 busiest models
  const days = Object.keys(next.byDay).sort();
  for (const old of days.slice(0, Math.max(0, days.length - 90))) delete next.byDay[old];
  const models = Object.entries(next.byModel);
  if (models.length > 120) {
    models.sort((a, b) => b[1].prompt + b[1].completion - (a[1].prompt + a[1].completion));
    next.byModel = Object.fromEntries(models.slice(0, 120));
  }
  return next;
}

function structuredCloneRecord(r: Record<string, Totals>): Record<string, Totals> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v }]));
}

export interface UsageSummary {
  total: number;
  today: number;
  last7: number;
  calls: number;
  budget?: number;
  left?: number;
  /** 0..1 of the budget used */
  used?: number;
}

export function summarize(state: UsageState, now = Date.now()): UsageSummary {
  const total = state.total.prompt + state.total.completion;
  const today = state.byDay[day(now)] ?? 0;
  let last7 = 0;
  for (let i = 0; i < 7; i++) last7 += state.byDay[day(now - i * 86_400_000)] ?? 0;
  const out: UsageSummary = { total, today, last7, calls: state.total.calls };
  if (state.budget && state.budget > 0) {
    out.budget = state.budget;
    out.left = Math.max(0, state.budget - total);
    out.used = Math.min(1, total / state.budget);
  }
  return out;
}

/** 7,612,345,678 → "7.61B"; 48,200 → "48.2K". */
export function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 1 : 2)}K`;
  return String(Math.round(n));
}

/** "7.6B", "7,600,000,000", "500m", "1.2 billion" → a number; undefined when it is not one. */
export function parseTokenCount(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/[,_\s]/g, '');
  const m = /^(\d+(?:\.\d+)?)(k|m|mn|b|bn|billion|million|thousand)?$/.exec(t);
  if (!m) return undefined;
  const unit = m[2] ?? '';
  const mult = unit.startsWith('b') ? 1e9 : unit.startsWith('m') ? 1e6 : unit.startsWith('k') || unit === 'thousand' ? 1e3 : 1;
  const n = Math.round(Number(m[1]) * mult);
  return n > 0 ? n : undefined;
}
