'use client';

import { withKeys } from '@/lib/keys';
import { useWorkspace } from '@/lib/store';
import {
  activeEndpoints,
  createHealth,
  endpointKeys,
  estimateTokens,
  gatewayKind,
  noteCall,
  planCandidates,
  restingNow,
  runWithFailover,
  type AttemptResult,
  type Candidate,
  type Failure,
  type RestingItem,
} from './gateway.ts';
import type { ChatMessage, CustomEndpointConfig, ProviderId, StreamFrame } from './types.ts';

/**
 * How the app talks to a model: one place for every chat call.
 *
 * `/api/chat` is the same route in the web build and inside the APK, and it only ever sees one concrete model. This is
 * where a *gateway* choice ("Auto") becomes a concrete one: the plan comes from gateway.ts, each attempt is an ordinary
 * call, and an attempt that fails before showing the user anything is replaced by the next candidate. Every call, gateway
 * or not, is also counted in the token meter.
 */

export interface StreamCallbacks {
  onDelta?: (delta: string, full: string) => void;
  onReasoning?: (delta: string, full: string) => void;
  onError?: (message: string) => void;
}

export interface ChatBody {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  json?: boolean;
  custom?: CustomEndpointConfig;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  usage?: StreamFrame & { type: 'usage' };
  error?: string;
  finishReason?: string;
  /** HTTP status and error code of a failed call, when the route gave them. */
  status?: number;
  code?: string;
  /** Whether any text reached the callbacks (after that, a failed call cannot be retried elsewhere). */
  emitted?: boolean;
}

/** One health record for the whole session: what is resting, and who answered last. */
const health = createHealth();
let rotation = 0;

// ── Streaming ───────────────────────────────────────────────────────────────

async function streamOnce(body: ChatBody, callbacks: StreamCallbacks, signal?: AbortSignal): Promise<StreamResult> {
  let content = '';
  let reasoning = '';
  let usage: (StreamFrame & { type: 'usage' }) | undefined;
  let error: string | undefined;
  let code: string | undefined;
  let finishReason: string | undefined;
  let emitted = false;

  let res: Response;
  try {
    // A raw caller signal with no timeout means a genuinely stuck connection (not the upstream provider erroring,
    // which the server route already bounds internally) never resolves or rejects, and the whole chat run hangs
    // forever with nothing to catch. 300s matches the server route's own maxDuration.
    const timeout = AbortSignal.timeout(300_000);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    res = await fetch('/api/chat', withKeys({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal: composed,
    }));
  } catch (err) {
    const message = (err as Error).name === 'AbortError' ? 'Run cancelled.' : `Gateway unreachable: ${(err as Error).message}`;
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const message = payload.error ?? `Gateway returned ${res.status}.`;
    callbacks.onError?.(message);
    return { content, reasoning, error: message, status: res.status, code: payload.code };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const message = 'Gateway returned an empty stream.';
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const SEP = /\r?\n\r?\n/g;
      for (;;) {
        SEP.lastIndex = 0;
        const match = SEP.exec(buffer);
        if (!match) break;
        const chunk = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        for (const line of chunk.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let frame: StreamFrame;
          try {
            frame = JSON.parse(raw) as StreamFrame;
          } catch {
            continue;
          }

          switch (frame.type) {
            case 'delta':
              content += frame.delta;
              if (frame.delta) emitted = true;
              callbacks.onDelta?.(frame.delta, content);
              break;
            case 'reasoning':
              reasoning += frame.delta;
              if (frame.delta) emitted = true;
              callbacks.onReasoning?.(frame.delta, reasoning);
              break;
            case 'usage':
              usage = frame;
              break;
            case 'error':
              error = frame.message;
              code = frame.code;
              callbacks.onError?.(frame.message);
              break;
            case 'done':
              // Kept: "length" is the provider saying the reply was cut off.
              if (frame.finishReason) finishReason = frame.finishReason;
              break;
            default:
              break;
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      error = `Stream interrupted: ${(err as Error).message}`;
      callbacks.onError?.(error);
    }
  } finally {
    reader.releaseLock();
  }

  return { content, reasoning, usage, error, finishReason, code, emitted };
}

// ── Single-shot ─────────────────────────────────────────────────────────────

class ChatError extends Error {
  status?: number;
  code?: string;
}

async function completeOnce(
  body: ChatBody & { json?: boolean },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  // A stalled provider on a non-streaming call had no timeout of its own, only the user's own Stop button — so a hung
  // planner call left the run stuck forever. Composed with the caller's signal so Stop still cuts a slow call short.
  const timeout = AbortSignal.timeout(timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch('/api/chat', withKeys({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
      signal: composed,
    }));
  } catch (err) {
    const e = new ChatError((err as Error).name === 'AbortError' && signal?.aborted ? 'Run cancelled.' : `Gateway unreachable: ${(err as Error).message}`);
    throw e;
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const e = new ChatError(payload.error ?? `Gateway returned ${res.status}`);
    e.status = res.status;
    e.code = payload.code;
    throw e;
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}

// ── The token meter ─────────────────────────────────────────────────────────

function charsOf(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') n += m.content.length;
    else for (const p of m.content) n += p.text?.length ?? 0;
  }
  return n;
}

/** Who to credit: the endpoint's own name for a custom model, the provider's for the built-in ones. */
function whoIs(provider: ProviderId, custom?: CustomEndpointConfig): string {
  if (provider === 'nim') return 'NVIDIA NIM';
  if (provider === 'pollinations') return 'Pollinations';
  if (!custom) return 'Custom';
  const found = useWorkspace.getState().endpoints.find((e) => e.baseUrl === custom.baseUrl);
  return found?.label ?? new URL(custom.baseUrl).hostname;
}

function count(provider: ProviderId, model: string, custom: CustomEndpointConfig | undefined, messages: ChatMessage[], reply: number, usage?: StreamResult['usage'], via?: Candidate): void {
  const prompt = usage?.promptTokens ?? estimateTokens(charsOf(messages));
  const completion = usage?.completionTokens ?? (usage?.totalTokens && usage.promptTokens != null ? usage.totalTokens - usage.promptTokens : estimateTokens(reply));
  useWorkspace.getState().recordUsage({ provider: whoIs(provider, custom), model }, { prompt, completion });
  // Also remembered per model and key, so the plan can stay under the limits the free provider publishes.
  if (via) noteCall(health, via, prompt + completion, Date.now());
}

// ── The two calls the app uses ──────────────────────────────────────────────

function plan(kind: NonNullable<ReturnType<typeof gatewayKind>>): Candidate[] {
  const s = useWorkspace.getState();
  return planCandidates(kind, { models: s.models, endpoints: activeEndpoints(s.endpoints, s.freeApis), health, now: Date.now(), rotation: rotation++ });
}

/** Does the message carry a picture? Then only models that can see are fallbacks. */
function hasImage(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

/**
 * What to try for a call. A gateway model ("gateway/auto") gets the gateway's plan. A model pinned from a *free* provider
 * gets itself first (on whichever of its keys still has room) and then the same chain as a fallback, so a spent free
 * allowance never ends in an error while another connected model could have answered. Anything else — NVIDIA, Pollinations,
 * your own endpoint — is called as picked, exactly as before.
 */
function routeFor(body: ChatBody): Candidate[] | null {
  const kind = gatewayKind(body.model, body.provider);
  if (kind) return plan(kind);
  const s = useWorkspace.getState();
  if (body.provider !== 'custom' || !body.custom || !s.freeApis) return null;
  const endpoint = s.endpoints.find((e) => e.freeId && e.enabled && e.baseUrl === body.custom!.baseUrl);
  if (!endpoint) return null;
  const pinnedModel = s.models.filter((m) => m.provider === 'custom' && m.endpointId === endpoint.id && m.id === body.model);
  const first = planCandidates('auto', { models: pinnedModel, endpoints: s.endpoints, health, now: Date.now(), rotation: rotation++ });
  const rest = plan(hasImage(body.messages) ? 'vision' : 'auto').filter((c) => !(c.endpointId === endpoint.id && c.model === body.model));
  const chain = [...first, ...rest];
  return chain.length ? chain : null;
}

/**
 * The models a call would try, in order: the gateway's plan, a pinned free model with its fallbacks, or just the one picked.
 * Background jobs use this to know what to write down for the bridge.
 */
export function candidatesFor(body: ChatBody): Array<{ provider: ProviderId; model: string; label?: string; custom?: CustomEndpointConfig }> {
  const route = routeFor(body);
  if (route) return route.map((c) => ({ provider: c.provider, model: c.model, label: c.label, custom: c.custom }));
  return [{ provider: body.provider, model: body.model, custom: body.custom }];
}

/** Who is resting right now and why — for the status list in Settings → Free LLM APIs. */
export function gatewayResting(): RestingItem[] {
  const s = useWorkspace.getState();
  return restingNow(health, s.endpoints, Date.now(), (o) => (o === 'nim' ? 'NVIDIA NIM' : o === 'pollinations' ? 'Pollinations' : o));
}

function keyCountOf(c: Candidate): number {
  const e = useWorkspace.getState().endpoints.find((x) => x.id === c.endpointId);
  return e ? Math.max(1, endpointKeys(e).length) : 1;
}

function noteRoute(c: Candidate, switches: number): void {
  useWorkspace.getState().setGatewayLast({ label: c.label, switches, at: Date.now() });
}

function failureOf(r: StreamResult): Failure {
  return { status: r.status, code: r.code, message: r.error ?? 'The model returned nothing.' };
}

/** Streams a reply. A gateway model ("gateway/auto") is resolved to a real one here, with fallbacks. */
export async function streamCompletion(body: ChatBody, callbacks: StreamCallbacks, signal?: AbortSignal): Promise<StreamResult> {
  const route = routeFor(body);
  if (!route) {
    const r = await streamOnce(body, callbacks, signal);
    count(body.provider, body.model, body.custom, body.messages, r.content.length + r.reasoning.length, r.usage);
    return r;
  }

  // Errors from an attempt that gets replaced are not shown; only the final outcome is.
  const seen: StreamCallbacks = { onDelta: callbacks.onDelta, onReasoning: callbacks.onReasoning };
  let last: StreamResult | undefined;
  const out = await runWithFailover<StreamResult>(
    route,
    health,
    async (c): Promise<AttemptResult<StreamResult>> => {
      const r = await streamOnce({ ...body, provider: c.provider, model: c.model, custom: c.custom }, seen, signal);
      last = r;
      if (r.error) return { ok: false, error: failureOf(r), emitted: r.emitted };
      if (!r.content && !r.reasoning) return { ok: false, error: { code: 'empty_completion', message: `${c.label} returned an empty completion.` } };
      count(c.provider, c.model, c.custom, body.messages, r.content.length + r.reasoning.length, r.usage, c);
      return { ok: true, value: r };
    },
    { keyCountOf },
  );

  if (out.ok && out.value && out.used) {
    noteRoute(out.used, out.tried.length);
    return out.value;
  }
  const message = out.lastError ?? 'No model answered.';
  callbacks.onError?.(message);
  return { content: last?.emitted ? last.content : '', reasoning: last?.emitted ? last.reasoning : '', error: message, emitted: last?.emitted };
}

/** One answer, no streaming — for planning and other internal steps. A gateway model is resolved here too. */
export async function complete(body: ChatBody, signal?: AbortSignal, timeoutMs = 45_000): Promise<string> {
  const route = routeFor(body);
  if (!route) {
    const text = await completeOnce(body, signal, timeoutMs);
    count(body.provider, body.model, body.custom, body.messages, text.length);
    return text;
  }
  const out = await runWithFailover<string>(
    route.slice(0, 5),
    health,
    async (c): Promise<AttemptResult<string>> => {
      try {
        const text = await completeOnce({ ...body, provider: c.provider, model: c.model, custom: c.custom }, signal, Math.min(timeoutMs, 30_000));
        if (!text.trim()) return { ok: false, error: { code: 'empty_completion', message: `${c.label} returned an empty completion.` } };
        count(c.provider, c.model, c.custom, body.messages, text.length, undefined, c);
        return { ok: true, value: text };
      } catch (err) {
        const e = err as ChatError;
        return { ok: false, error: { status: e.status, code: e.code, message: e.message } };
      }
    },
    { keyCountOf },
  );
  if (out.ok && out.value !== undefined && out.used) {
    noteRoute(out.used, out.tried.length);
    return out.value;
  }
  throw new Error(out.lastError ?? 'No model answered.');
}
